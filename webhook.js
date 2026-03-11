// api/webhook.js — YourPass ✅ VERSION SÉCURISÉE
//
// CORRECTIONS CRITIQUES :
//   ✅ Raw body pour vérification HMAC (Vercel parse le JSON par défaut — bug corrigé)
//   ✅ Idempotence : upsert au lieu d'insert → pas de doublon si FedaPay renvoie 2x
//   ✅ Email avec QR code via /api/send-ticket
//   ✅ Gestion declined / cancelled / refunded → mise à jour du statut en base
//   ✅ Toujours 200 vers FedaPay même en cas d'erreur interne

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ── IMPORTANT : export config pour désactiver le parsing JSON de Vercel ──────
// Sans ça, req.body est déjà un objet et le HMAC ne peut pas être vérifié
export const config = { api: { bodyParser: false } };

// ── Lire le raw body depuis le stream ────────────────────────────────────────
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Générer une référence billet lisible ─────────────────────────────────────
function makeTicketRef(txId) {
  return 'YP-' + String(txId).slice(-6).toUpperCase().padStart(6, '0');
}

export default async function handler(req, res) {
  // Toujours accepter OPTIONS (pas utile pour un webhook mais sécurisant)
  if (req.method !== 'POST') return res.status(405).end();

  // ── 1. Lire le raw body AVANT tout parsing ───────────────────────────────
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch {
    return res.status(400).json({ error: 'Impossible de lire le body' });
  }

  // ── 2. Vérification de signature HMAC ────────────────────────────────────
  const WEBHOOK_SECRET = process.env.FEDAPAY_WEBHOOK_SECRET;
  if (WEBHOOK_SECRET) {
    const sigHeader = req.headers['x-fedapay-signature'] || req.headers['x-signature'] || '';
    const provided  = sigHeader.replace(/^sha256=/, '');

    if (!provided) {
      console.warn('[Webhook] ⛔ Signature manquante');
      return res.status(401).json({ error: 'Signature manquante' });
    }

    const expected = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    try {
      const valid = crypto.timingSafeEqual(
        Buffer.from(provided, 'hex'),
        Buffer.from(expected, 'hex')
      );
      if (!valid) {
        console.warn('[Webhook] ⛔ Signature invalide');
        return res.status(401).json({ error: 'Signature invalide' });
      }
    } catch {
      return res.status(401).json({ error: 'Erreur vérification signature' });
    }
  } else {
    console.warn('[Webhook] ⚠️ FEDAPAY_WEBHOOK_SECRET non défini — signature non vérifiée');
  }

  // ── 3. Parser le body ────────────────────────────────────────────────────
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Body JSON invalide' });
  }

  const eventName = event?.name;
  const tx        = event?.data?.object || event?.data || {};
  const txId      = tx?.id;
  const amount    = tx?.amount;
  const status    = tx?.status;
  const customer  = tx?.customer || {};
  const metadata  = tx?.custom_metadata || {};

  if (!eventName || !txId) {
    return res.status(400).json({ error: 'Payload FedaPay invalide' });
  }

  const email       = customer?.email || metadata?.customer_email || null;
  const name        = metadata?.customer_name || `${customer?.firstname || ''} ${customer?.lastname || ''}`.trim() || 'Client';
  const eventId     = metadata?.event_id || 'global';
  const ticketRef   = makeTicketRef(txId);

  console.log(`[Webhook] 📩 ${eventName} — TX #${txId} (${status}) — ${email}`);

  // ── 4. Routing par type d'événement ─────────────────────────────────────
  switch (eventName) {

    // ✅ Paiement validé
    case 'transaction.approved':
    case 'transaction.paid': {
      // ── A. Upsert en base (idempotent) ──────────────────────────────────
      const { error: dbError } = await supabase
        .from('tickets')
        .upsert({
          payment_id:    String(txId),
          ticket_ref:    ticketRef,
          user_email:    email,
          customer_name: name,
          amount:        amount,
          status:        'paid',
          event_id:      eventId,
          paid_at:       new Date().toISOString(),
        }, {
          onConflict: 'payment_id',   // ← idempotence : pas de doublon
          ignoreDuplicates: false,     // met à jour si déjà présent
        });

      if (dbError) {
        console.error('[Webhook] ❌ Supabase upsert:', dbError.message);
        // On continue quand même pour envoyer l'email
      } else {
        console.log(`[Webhook] ✅ Ticket ${ticketRef} enregistré en base`);
      }

      // ── B. Envoyer le billet par email via /api/send-ticket ─────────────
      if (email) {
        try {
          const baseUrl = process.env.CALLBACK_URL?.replace(/\/$/, '') || 'https://yourpass.vercel.app';
          const ticketRes = await fetch(`${baseUrl}/api/send-ticket`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              transactionId: String(txId),
              email,
              name,
              eventName:  metadata?.event_name  || eventId,
              eventDate:  metadata?.event_date  || '',
              eventVenue: metadata?.event_venue || 'Cotonou, Bénin',
              ticketType: metadata?.ticket_type || 'Standard',
              amount,
            }),
          });
          const ticketData = await ticketRes.json();
          if (ticketData.success) {
            console.log(`[Webhook] 📧 Billet ${ticketData.ticketId} envoyé à ${email}`);
          } else {
            console.error('[Webhook] ❌ send-ticket:', ticketData.error);
          }
        } catch (err) {
          console.error('[Webhook] ❌ Appel send-ticket:', err.message);
        }
      }
      break;
    }

    // ❌ Paiement refusé ou annulé
    case 'transaction.declined':
    case 'transaction.cancelled': {
      const newStatus = eventName === 'transaction.declined' ? 'declined' : 'cancelled';
      const { error } = await supabase
        .from('tickets')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('payment_id', String(txId));

      if (error) {
        console.warn(`[Webhook] Ticket TX #${txId} non trouvé en base (${newStatus}) — ignoré`);
      } else {
        console.log(`[Webhook] 🔄 Ticket TX #${txId} → ${newStatus}`);
      }
      break;
    }

    // 💸 Remboursement
    case 'transaction.refunded': {
      const { error } = await supabase
        .from('tickets')
        .update({ status: 'refunded', updated_at: new Date().toISOString() })
        .eq('payment_id', String(txId));

      console.log(error
        ? `[Webhook] Remboursement TX #${txId} — ticket non trouvé`
        : `[Webhook] 💸 Ticket TX #${txId} → refunded`
      );
      break;
    }

    default:
      console.log(`[Webhook] Événement ignoré : ${eventName}`);
  }

  // ── Toujours 200 → FedaPay arrête de renvoyer si on répond 2xx ──────────
  return res.status(200).json({ received: true, ref: ticketRef });
}