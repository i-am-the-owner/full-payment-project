'use strict';
// AlmaPay admin console. Read-only except suspend/unsuspend and resolving alerts.
// Everything is drawn with textContent (never innerHTML), so data from the API
// cannot inject markup. The access token lives in memory only: closing the tab signs out.
(function () {
  const API = '/api/v1';
  let token = null;
  const main = document.getElementById('main');
  const nav = document.getElementById('nav');
  const signout = document.getElementById('signout');

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    for (const kid of kids.flat())
      node.append(kid instanceof Node ? kid : document.createTextNode(String(kid ?? '')));
    return node;
  }
  const show = (...nodes) => main.replaceChildren(...nodes);
  const fmt = (v) =>
    v == null
      ? ''
      : /^\d{4}-\d\d-\d\dT/.test(String(v))
        ? String(v).replace('T', ' ').slice(0, 19)
        : String(v);
  const money = (minor, cur) =>
    (Number(minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 }) + ' ' + cur;

  async function api(path, options) {
    const res = await fetch(API + path, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: options && options.body ? JSON.stringify(options.body) : undefined,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
      throw new Error((body.error && body.error.message) || 'Request failed (' + res.status + ')');
    return body.data;
  }

  function table(columns, rows, onClick) {
    if (!rows.length) return el('p', { class: 'muted' }, 'Nothing to show.');
    return el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          columns.map((c) => el('th', {}, c.label)),
        ),
      ),
      el(
        'tbody',
        {},
        rows.map((r) =>
          el(
            'tr',
            onClick ? { class: 'link', onclick: () => onClick(r) } : {},
            columns.map((c) => el('td', {}, c.get(r))),
          ),
        ),
      ),
    );
  }
  const guard =
    (fn) =>
    async (...a) => {
      try {
        await fn(...a);
      } catch (e) {
        show(el('p', { class: 'err' }, e.message));
      }
    };

  // --- Sign in ---------------------------------------------------------------
  function loginView(message) {
    const email = el('input', { type: 'email', autocomplete: 'username', required: true });
    const password = el('input', {
      type: 'password',
      autocomplete: 'current-password',
      required: true,
    });
    const code = el('input', {
      inputmode: 'numeric',
      autocomplete: 'one-time-code',
      pattern: '\\d{6}',
      required: true,
    });
    const error = el('p', { class: 'err' }, message || '');
    const form = el(
      'form',
      { class: 'card login' },
      el('h2', {}, 'Admin sign in'),
      el('label', {}, 'Email', email),
      el('label', {}, 'Password', password),
      el('label', {}, 'Two-step code (required)', code),
      error,
      el('p', {}, el('button', { class: 'primary', type: 'submit' }, 'Sign in')),
    );
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const res = await fetch(API + '/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: email.value,
            password: password.value,
            totpCode: code.value,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error('Sign in failed. Check the details and the code.');
        token = body.data.accessToken;
        await api('/admin/whoami'); // fails unless the account is an admin with 2FA on
        start();
      } catch (e) {
        token = null;
        loginView(e.message);
      }
    });
    nav.hidden = true;
    signout.hidden = true;
    show(form);
  }

  // --- Views -----------------------------------------------------------------
  const views = {
    Dashboard: guard(async () => {
      const [day, month] = await Promise.all([
        api('/admin/dashboard?period=day&days=14'),
        api('/admin/dashboard?period=month&days=366'),
      ]);
      const t = month.thisMonth;
      const cols = [
        { label: 'Period', get: (r) => r.period },
        { label: 'Currency', get: (r) => r.currency },
        { label: 'Transfers', get: (r) => r.transfers },
        { label: 'Completed', get: (r) => r.completed },
        { label: 'Volume', get: (r) => money(r.volumeMinor, r.currency) },
        {
          label: '≈ USD',
          get: (r) => (r.approxUsd == null ? 'no rate' : r.approxUsd.toLocaleString()),
        },
      ];
      const lim = day.limits;
      const paused = day.transfersPaused;
      const toggle = guard(async () => {
        let message;
        if (!paused.paused) {
          message = prompt(
            'Message customers will see (at least 5 characters). Leave empty for the standard message:',
          );
          if (message === null) return;
        }
        const code = prompt('Your current authenticator code:');
        if (!code) return;
        const body = { paused: !paused.paused, code: code.trim() };
        if (message && message.trim().length >= 5) body.message = message.trim();
        await api('/admin/settings/transfers-paused', { method: 'PUT', body });
        views.Dashboard();
      });
      const money0 = (v) => lim.currency + ' ' + Number(v).toLocaleString('en-GB');
      show(
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'New transfers'),
          el(
            'p',
            { class: paused.paused ? 'err' : '' },
            paused.paused
              ? 'New transfers are paused. Customers see: ' + paused.message
              : 'New transfers are running.',
          ),
          el('p', { class: 'muted' }, 'Transfers already in progress are never affected.'),
          el(
            'button',
            { class: paused.paused ? 'primary' : 'danger', onclick: toggle },
            paused.paused ? 'Resume new transfers' : 'Pause new transfers',
          ),
        ),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Customer limits'),
          el(
            'p',
            {},
            'Per transfer ' +
              money0(lim.perTransfer) +
              ' · per day ' +
              money0(lim.perDay) +
              ' (rolling 24 h) · per month ' +
              money0(lim.perMonth) +
              ' (rolling 30 d)',
          ),
          el(
            'p',
            { class: 'muted' },
            'Set with TRANSFER_LIMIT_* in the environment; changing them needs a deploy.',
          ),
        ),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'This month vs target'),
          el(
            'p',
            {},
            t.approxUsd == null
              ? 'Add display rates (DASHBOARD_USD_RATES) to see USD.'
              : '≈ USD ' +
                  t.approxUsd.toLocaleString() +
                  ' of ' +
                  t.targetUsd.toLocaleString() +
                  ' (' +
                  Math.round((t.approxUsd / t.targetUsd) * 100) +
                  '%)',
          ),
          el('p', { class: 'muted' }, t.note),
        ),
        el('div', { class: 'card' }, el('h2', {}, 'Per month'), table(cols, month.rows)),
        el('div', { class: 'card' }, el('h2', {}, 'Per day (last 14)'), table(cols, day.rows)),
      );
    }),
    Users: guard(async () => {
      const q = el('input', { placeholder: 'Email, name or user id' });
      const out = el('div');
      const run = guard(async () => {
        const d = await api('/admin/users?q=' + encodeURIComponent(q.value));
        out.replaceChildren(
          table(
            [
              { label: 'Email', get: (r) => r.email },
              { label: 'Name', get: (r) => r.name },
              { label: 'Status', get: (r) => r.status },
              { label: 'KYC', get: (r) => r.kycStatus },
              { label: 'Created', get: (r) => fmt(r.createdAt) },
            ],
            d.users,
            (r) => userView(r.id),
          ),
        );
      });
      show(
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Users'),
          el(
            'div',
            { class: 'row' },
            q,
            el('button', { class: 'primary', onclick: run }, 'Search'),
          ),
          out,
        ),
      );
      run();
    }),
    Transfers: guard(async () => {
      const f = {
        id: el('input', { placeholder: 'Transfer id / reference' }),
        userId: el('input', { placeholder: 'User id' }),
        status: el(
          'select',
          {},
          [
            '',
            'DRAFT',
            'AWAITING_FUNDS',
            'PROCESSING',
            'SENT',
            'COMPLETED',
            'CANCELLED',
            'REFUNDED',
            'FAILED',
          ].map((s) => el('option', { value: s }, s || 'Any status')),
        ),
        from: el('input', { type: 'date' }),
        to: el('input', { type: 'date' }),
      };
      const out = el('div');
      const run = guard(async () => {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(f))
          if (v.value)
            p.set(
              k,
              k === 'to'
                ? new Date(Date.parse(v.value) + 86400000).toISOString()
                : k === 'from'
                  ? new Date(v.value).toISOString()
                  : v.value,
            );
        out.replaceChildren(transferTable((await api('/admin/transfers?' + p)).transfers));
      });
      show(
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Transfers'),
          el(
            'div',
            { class: 'row' },
            Object.values(f),
            el('button', { class: 'primary', onclick: run }, 'Search'),
          ),
          out,
        ),
      );
      run();
    }),
    Reports: guard(async () => {
      const [stuck, failed, hooks, reviews, alerts] = await Promise.all([
        api('/admin/reports/stuck-transfers'),
        api('/admin/reports/failed-transfers'),
        api('/admin/reports/webhook-errors'),
        api('/admin/reports/identity-reviews'),
        api('/admin/alerts'),
      ]);
      show(
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Stuck for 24h+ (not final)'),
          transferTable(stuck.transfers),
        ),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Failed or bounced'),
          transferTable(failed.transfers),
        ),
        el('div', { class: 'card' }, el('h2', {}, 'Webhook errors'), webhookTable(hooks.webhooks)),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Identity mismatch reviews'),
          table(
            [
              { label: 'Email', get: (r) => r.email },
              { label: 'Provider', get: (r) => r.provider },
              { label: 'Since', get: (r) => fmt(r.updatedAt) },
            ],
            reviews.reviews,
            (r) => userView(r.userId),
          ),
        ),
        el(
          'div',
          { class: 'card' },
          el('h2', {}, 'Open alerts'),
          table(
            [
              { label: 'Kind', get: (r) => r.kind },
              { label: 'Severity', get: (r) => r.severity },
              { label: 'Message', get: (r) => r.message },
              { label: 'Seen', get: (r) => r.occurrences + '× ' + fmt(r.lastSeenAt) },
              {
                label: '',
                get: (r) =>
                  el(
                    'button',
                    {
                      onclick: guard(async (ev) => {
                        ev.stopPropagation();
                        await api('/admin/alerts/' + r.id + '/resolve', {
                          method: 'POST',
                          body: {},
                        });
                        views.Reports();
                      }),
                    },
                    'Resolve',
                  ),
              },
            ],
            alerts.alerts,
          ),
        ),
      );
    }),
  };

  const transferTable = (rows) =>
    table(
      [
        { label: 'Reference', get: (r) => r.reference },
        { label: 'Status', get: (r) => r.status },
        {
          label: 'Amount',
          get: (r) =>
            money(r.sourceAmountMinor, r.sourceCurrency) +
            ' → ' +
            money(r.destinationAmountMinor, r.destinationCurrency),
        },
        { label: 'Updated', get: (r) => fmt(r.updatedAt) },
      ],
      rows,
      (r) => transferView(r.id),
    );
  const webhookTable = (rows) =>
    table(
      [
        { label: 'Received', get: (r) => fmt(r.receivedAt) },
        { label: 'Provider', get: (r) => r.provider },
        { label: 'Type', get: (r) => r.eventType },
        { label: 'Signature', get: (r) => (r.signatureVerified ? 'ok' : 'INVALID') },
        {
          label: 'Result',
          get: (r) => r.processingStatus + (r.processingError ? ': ' + r.processingError : ''),
        },
      ],
      rows,
    );

  const userView = guard(async (id) => {
    const { user: u } = await api('/admin/users/' + id);
    const suspended = u.status === 'suspended';
    const act = guard(async () => {
      if (suspended) await api('/admin/users/' + id + '/unsuspend', { method: 'POST', body: {} });
      else {
        const reason = prompt('Reason for suspending (recorded in the audit log):');
        if (!reason || reason.trim().length < 3) return;
        await api('/admin/users/' + id + '/suspend', {
          method: 'POST',
          body: { reason: reason.trim() },
        });
      }
      userView(id);
    });
    show(
      el(
        'div',
        { class: 'card' },
        el('h2', {}, u.email),
        el(
          'p',
          {},
          'Name: ' +
            (u.name || '–') +
            ' · Country: ' +
            (u.countryOfResidence || '–') +
            ' · Status: ' +
            u.status +
            ' · Email verified: ' +
            u.emailVerified +
            ' · 2FA: ' +
            u.twoFactorEnabled +
            ' · Roles: ' +
            (u.roles.join(', ') || 'customer'),
        ),
        el(
          'p',
          {},
          'Created ' +
            fmt(u.createdAt) +
            ' · Last sign-in ' +
            (fmt(u.lastLoginAt) || '–') +
            ' · Transfers: ' +
            u.transferCount,
        ),
        el(
          'button',
          { class: suspended ? 'primary' : 'danger', onclick: act },
          suspended ? 'Unsuspend' : 'Suspend',
        ),
      ),
      el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Provider link and KYC'),
        table(
          [
            { label: 'Provider', get: (r) => r.provider },
            { label: 'KYC status', get: (r) => r.kycStatus },
            { label: 'Provider customer', get: (r) => r.providerCustomerId },
            { label: 'Updated', get: (r) => fmt(r.updatedAt) },
          ],
          u.providerLinks,
        ),
      ),
      el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Recent account events'),
        table(
          [
            { label: 'When', get: (r) => fmt(r.createdAt) },
            { label: 'Action', get: (r) => r.action },
            { label: 'By', get: (r) => r.actorType },
          ],
          u.recentAudit,
        ),
      ),
      el('p', {}, el('button', { onclick: () => views.Transfers() }, 'Search transfers')),
    );
  });

  const transferView = guard(async (id) => {
    const { transfer: t } = await api('/admin/transfers/' + id);
    show(
      el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Transfer ' + t.reference + ' — ' + t.status),
        el(
          'p',
          {},
          'Sent ' +
            money(t.sourceAmountMinor, t.sourceCurrency) +
            ' · fee ' +
            money(t.feeAmountMinor, t.sourceCurrency) +
            ' · customer pays ' +
            money(t.totalToPayMinor, t.sourceCurrency) +
            ' · recipient gets ' +
            money(t.destinationAmountMinor, t.destinationCurrency) +
            ' · rate ' +
            t.exchangeRate,
        ),
        el(
          'p',
          {},
          'Provider: ' +
            (t.provider || '–') +
            ' · provider id ' +
            (t.providerTransferId || '–') +
            ' · provider status ' +
            (t.providerStatus || '–') +
            ' · funding ' +
            (t.fundingMethod || '–'),
        ),
        t.failureReason ? el('p', { class: 'err' }, 'Failure: ' + t.failureReason) : '',
        el('p', { class: 'muted' }, 'Read-only: an admin cannot change amounts or statuses.'),
        el('button', { onclick: () => userView(t.userId) }, 'View customer'),
      ),
      el(
        'div',
        { class: 'card' },
        el('h2', {}, 'Timeline'),
        table(
          [
            { label: 'When', get: (r) => fmt(r.occurredAt) },
            { label: 'From', get: (r) => r.fromStatus },
            { label: 'To', get: (r) => r.status },
            { label: 'Source', get: (r) => r.source },
            { label: 'Reason', get: (r) => r.reason },
          ],
          t.events,
        ),
      ),
      el('div', { class: 'card' }, el('h2', {}, 'Webhook history'), webhookTable(t.webhooks)),
    );
  });

  function start() {
    nav.hidden = false;
    signout.hidden = false;
    nav.replaceChildren(
      ...Object.keys(views).map((name) =>
        el(
          'button',
          {
            onclick: (ev) => {
              nav.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
              ev.currentTarget.classList.add('active');
              views[name]();
            },
          },
          name,
        ),
      ),
    );
    nav.firstChild.click();
  }
  signout.addEventListener('click', () => {
    token = null;
    loginView();
  });
  loginView();
})();
