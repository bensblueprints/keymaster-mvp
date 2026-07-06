import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Search, KeyRound, X, Ban, RotateCcw, MonitorSmartphone, Download, ExternalLink } from 'lucide-react';
import { api } from '../api.js';
import { Card, Button, Input, Modal, Pill, CopyBtn, maskKey } from '../components/ui.jsx';

const statusOf = (l) =>
  l.revoked ? ['red', 'revoked'] : l.expires_at && new Date(l.expires_at + 'Z') < new Date() ? ['amber', 'expired'] : ['green', 'active'];

function Drawer({ id, onClose, notify, refresh }) {
  const [l, setL] = useState(null);
  const load = () => api.get(`/api/admin/licenses/${id}`).then(setL);
  useEffect(() => {
    load().catch(() => {});
  }, [id]);

  return (
    <motion.div
      className="fixed inset-y-0 right-0 w-full max-w-lg bg-zinc-900 border-l border-zinc-800 z-40 overflow-y-auto p-6"
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'tween', duration: 0.2 }}
    >
      {!l ? (
        <div className="text-zinc-500">Loading…</div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <KeyRound size={17} className="text-violet-400" /> License {l.id}
            </h2>
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200"><X size={18} /></button>
          </div>

          <Card className="p-4 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Pill color={statusOf(l)[0]}>{statusOf(l)[1]}</Pill>
              <span className="text-zinc-500 text-xs">{l.product_name} · {l.tier}</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-zinc-400 break-all">
              {maskKey(l.key)} <CopyBtn text={l.key} label="Copy full key" />
              <a href={`/license/${encodeURIComponent(l.key)}`} target="_blank" rel="noreferrer" className="text-zinc-500 hover:text-violet-400" title="Open customer portal">
                <ExternalLink size={13} />
              </a>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-zinc-400 pt-2">
              <div>Seats: {l.seats_used} / {l.seats}</div>
              <div>Issued: {l.issued_at?.slice(0, 10)}</div>
              <div>Expires: {l.expires_at ? l.expires_at.slice(0, 10) : 'never'}</div>
              <div>Customer: {l.customer_email || '—'}</div>
              {l.order_ref && <div>Order: {l.order_ref}</div>}
              {l.revoked ? <div className="text-red-400 col-span-2">Revoked{l.revoked_reason ? `: ${l.revoked_reason}` : ''}</div> : null}
            </div>
            <div className="pt-2">
              {l.revoked ? (
                <Button variant="ghost" onClick={async () => { await api.post(`/api/admin/licenses/${l.id}/unrevoke`); notify('License restored'); load(); refresh(); }}>
                  <RotateCcw size={14} /> Un-revoke
                </Button>
              ) : (
                <Button variant="danger" onClick={async () => {
                  const reason = prompt('Revocation reason (optional):') ?? '';
                  await api.post(`/api/admin/licenses/${l.id}/revoke`, { reason });
                  notify('License revoked'); load(); refresh();
                }}>
                  <Ban size={14} /> Revoke
                </Button>
              )}
            </div>
          </Card>

          <div>
            <h3 className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
              <MonitorSmartphone size={14} /> Activations
            </h3>
            {l.activations.length === 0 && <div className="text-xs text-zinc-500">No activations yet.</div>}
            <div className="space-y-2">
              {l.activations.map((a) => (
                <Card key={a.id} className={`p-3 text-xs flex items-center justify-between ${a.deactivated_at ? 'opacity-50' : ''}`}>
                  <div>
                    <div className="font-mono text-zinc-300">{a.fingerprint.slice(0, 20)}{a.fingerprint.length > 20 ? '…' : ''}</div>
                    <div className="text-zinc-500 mt-0.5">
                      {a.hostname || 'unknown host'} {a.app_version && `· v${a.app_version}`} · last seen {a.last_seen?.slice(0, 16)}
                      {a.deactivated_at && ' · deactivated'}
                    </div>
                  </div>
                  {!a.deactivated_at && (
                    <Button variant="ghost" className="!px-2.5 !py-1 text-xs" onClick={async () => {
                      await api.post(`/api/admin/activations/${a.id}/deactivate`);
                      notify('Seat freed'); load(); refresh();
                    }}>
                      Deactivate
                    </Button>
                  )}
                </Card>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
              <Download size={14} /> Downloads
            </h3>
            {l.downloads.length === 0 && <div className="text-xs text-zinc-500">No downloads yet.</div>}
            <div className="space-y-1 text-xs text-zinc-500">
              {l.downloads.map((d) => (
                <div key={d.id}>v{d.semver || '?'} · {d.created_at} · {d.ip || 'unknown ip'}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function Licenses({ notify }) {
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [drawer, setDrawer] = useState(null);
  const [modal, setModal] = useState(false);
  const [issued, setIssued] = useState(null);
  const [form, setForm] = useState({ product_id: '', tier: 'standard', seats: '', expires_at: '', customer_email: '', customer_name: '', order_ref: '', count: 1 });

  const load = () =>
    api.get(`/api/admin/licenses?search=${encodeURIComponent(search)}`).then(setRows);
  useEffect(() => {
    const t = setTimeout(() => load().catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    api.get('/api/admin/products').then(setProducts).catch(() => {});
  }, []);

  const issue = async () => {
    try {
      if (!form.product_id) return notify('Pick a product', true);
      const res = await api.post('/api/admin/licenses', { ...form, seats: form.seats || undefined, expires_at: form.expires_at || undefined });
      setIssued(Array.isArray(res) ? res : [res]);
      setModal(false);
      notify(`${Array.isArray(res) ? res.length : 1} license${Array.isArray(res) ? 's' : ''} issued`);
      load();
    } catch (e) {
      notify(e.message, true);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">Licenses</h1>
        <Button onClick={() => setModal(true)}><Plus size={15} /> Issue license</Button>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          placeholder="Search key, email, name, order ref…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-600"
        />
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
              <th className="py-3 pl-5">Key</th><th>Product</th><th>Tier</th><th>Seats</th><th>Customer</th><th>Status</th><th className="pr-5">Issued</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const [color, label] = statusOf(l);
              return (
                <tr key={l.id} onClick={() => setDrawer(l.id)} className="border-b border-zinc-800/60 hover:bg-zinc-800/40 cursor-pointer">
                  <td className="py-3 pl-5 font-mono text-xs text-zinc-300">
                    <span className="inline-flex items-center gap-2">
                      {maskKey(l.key)}
                      <span onClick={(e) => e.stopPropagation()}><CopyBtn text={l.key} /></span>
                    </span>
                  </td>
                  <td className="text-zinc-400">{l.product_slug}</td>
                  <td className="text-zinc-400">{l.tier}</td>
                  <td className="text-zinc-400">{l.seats_used}/{l.seats}</td>
                  <td className="text-zinc-400">{l.customer_email || '—'}</td>
                  <td><Pill color={color}>{label}</Pill></td>
                  <td className="pr-5 text-zinc-500 text-xs">{l.issued_at?.slice(0, 10)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="py-10 text-center text-zinc-500">No licenses found.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Modal open={modal} onClose={() => setModal(false)} title="Issue license">
        <div className="space-y-4">
          <label className="block">
            <span className="block text-xs font-medium text-zinc-400 mb-1.5">Product</span>
            <select
              value={form.product_id}
              onChange={(e) => setForm({ ...form, product_id: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-violet-600"
            >
              <option value="">Select…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Tier" value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} />
            <Input label="Seats (blank = product default)" type="number" min="1" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Expires (blank = perpetual)" type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
            <Input label="Bulk count" type="number" min="1" max="1000" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
          </div>
          <Input label="Customer email" type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Customer name" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} />
            <Input label="Order ref" value={form.order_ref} onChange={(e) => setForm({ ...form, order_ref: e.target.value })} />
          </div>
          <Button className="w-full justify-center" onClick={issue}>Issue</Button>
        </div>
      </Modal>

      <Modal open={!!issued} onClose={() => setIssued(null)} title={`Issued ${issued?.length || 0} key${issued?.length > 1 ? 's' : ''}`} wide>
        <p className="text-xs text-zinc-500 mb-3">Copy these now — full keys are shown masked elsewhere in the dashboard.</p>
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {(issued || []).map((l) => (
            <div key={l.id} className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2">
              <code className="flex-1 text-[11px] text-emerald-300 break-all">{l.key}</code>
              <CopyBtn text={l.key} />
            </div>
          ))}
        </div>
        {issued?.length > 1 && (
          <Button variant="ghost" className="mt-3" onClick={() => { navigator.clipboard.writeText(issued.map((l) => l.key).join('\n')); notify('All keys copied'); }}>
            Copy all
          </Button>
        )}
      </Modal>

      <AnimatePresence>
        {drawer && <Drawer id={drawer} onClose={() => setDrawer(null)} notify={notify} refresh={load} />}
      </AnimatePresence>
    </div>
  );
}
