import React, { useEffect, useRef, useState } from 'react';
import { Package, Plus, ArrowLeft, UploadCloud, Trash2, Webhook, RefreshCw, Send, ExternalLink } from 'lucide-react';
import { api } from '../api.js';
import { Card, Button, Input, Modal, Pill, CopyBtn } from '../components/ui.jsx';

const fmtSize = (n) => (!n ? '—' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`);

function ProductDetail({ id, onBack, notify }) {
  const [p, setP] = useState(null);
  const [semver, setSemver] = useState('');
  const [notes, setNotes] = useState('');
  const [extUrl, setExtUrl] = useState('');
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const fileRef = useRef();

  const load = () =>
    api.get(`/api/admin/products/${id}`).then((d) => {
      setP(d);
      setWebhookUrl(d.webhook_url || '');
    });
  useEffect(() => {
    load().catch(() => {});
  }, [id]);

  if (!p) return <div className="text-zinc-500">Loading…</div>;

  const addVersion = async () => {
    if (!semver) return notify('Enter a semver like 1.0.0', true);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('semver', semver);
      form.append('notes', notes);
      if (file) form.append('artifact', file);
      else if (extUrl) form.append('artifact_url', extUrl);
      await api.upload(`/api/admin/products/${id}/versions`, form);
      setSemver(''); setNotes(''); setFile(null); setExtUrl('');
      notify(`Version ${semver} published`);
      await load();
    } catch (e) {
      notify(e.message, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft size={15} /> All products
      </button>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{p.name}</h1>
          <div className="text-sm text-zinc-500 mt-1">
            slug <code className="text-violet-400">{p.slug}</code> · default {p.default_seats} seat{p.default_seats > 1 ? 's' : ''} · {p.licenses} licenses
          </div>
        </div>
      </div>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-4">Versions</h2>
        {p.versionList.length === 0 && <div className="text-sm text-zinc-500 mb-4">No versions yet — publish one below.</div>}
        {p.versionList.length > 0 && (
          <table className="w-full text-sm mb-5">
            <thead>
              <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
                <th className="py-2">Version</th><th>Artifact</th><th>Size</th><th>Notes</th><th>Published</th><th />
              </tr>
            </thead>
            <tbody>
              {p.versionList.map((v) => (
                <tr key={v.id} className="border-b border-zinc-800/60">
                  <td className="py-2.5 font-medium text-zinc-200">v{v.semver}</td>
                  <td className="text-zinc-400">
                    {v.artifact_path ? 'uploaded file' : v.artifact_url ? (
                      <span className="inline-flex items-center gap-1">external <ExternalLink size={12} /></span>
                    ) : '—'}
                  </td>
                  <td className="text-zinc-400">{fmtSize(v.size)}</td>
                  <td className="text-zinc-500 max-w-[220px] truncate">{v.notes || '—'}</td>
                  <td className="text-zinc-500">{v.created_at?.slice(0, 10)}</td>
                  <td className="text-right">
                    <button
                      onClick={async () => { await api.del(`/api/admin/versions/${v.id}`); notify(`v${v.semver} deleted`); load(); }}
                      className="text-zinc-600 hover:text-red-400"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Input label="Semver" placeholder="1.0.0" value={semver} onChange={(e) => setSemver(e.target.value)} />
            <Input label="Release notes" placeholder="What changed?" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <Input label="…or external artifact URL" placeholder="https://cdn.example.com/app-1.0.0.zip" value={extUrl} onChange={(e) => setExtUrl(e.target.value)} disabled={!!file} />
          </div>
          <div className="flex flex-col">
            <span className="block text-xs font-medium text-zinc-400 mb-1.5">Artifact file</span>
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); setFile(e.dataTransfer.files[0] || null); }}
              className={`flex-1 min-h-[110px] flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl cursor-pointer transition-colors ${
                dragOver ? 'border-violet-500 bg-violet-500/5' : 'border-zinc-700 hover:border-zinc-500'
              }`}
            >
              <UploadCloud size={22} className="text-zinc-500" />
              <span className="text-xs text-zinc-500">{file ? file.name : 'Drop a file or click to browse'}</span>
            </div>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => setFile(e.target.files[0] || null)} />
            <Button onClick={addVersion} disabled={busy} className="mt-3 self-end">
              <Plus size={15} /> Publish version
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-zinc-300 mb-1 flex items-center gap-2"><Webhook size={15} /> Activation webhook</h2>
        <p className="text-xs text-zinc-500 mb-4">
          POST JSON on activation / deactivation / validation_failed, signed with <code>X-Keymaster-Signature</code> (HMAC-SHA256).
        </p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <Input label="Webhook URL" placeholder="https://your-app.com/hooks/keymaster" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
          </div>
          <Button variant="ghost" onClick={async () => { await api.put(`/api/admin/products/${id}`, { webhook_url: webhookUrl }); notify('Webhook saved'); load(); }}>Save</Button>
          <Button variant="ghost" onClick={async () => {
            try { await api.post(`/api/admin/products/${id}/webhook/test`); notify('Test event dispatched'); }
            catch (e) { notify(e.message, true); }
          }}><Send size={14} /> Test</Button>
        </div>
        <div className="mt-4 flex items-center gap-2 text-xs text-zinc-500">
          Signing secret: <code className="text-zinc-300 bg-zinc-950 px-2 py-0.5 rounded">{p.webhook_secret}</code>
          <CopyBtn text={p.webhook_secret} />
          <button
            onClick={async () => { await api.post(`/api/admin/products/${id}/webhook/rotate-secret`); notify('Secret rotated'); load(); }}
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-200"
          >
            <RefreshCw size={12} /> rotate
          </button>
        </div>
      </Card>
    </div>
  );
}

export default function Products({ notify }) {
  const [products, setProducts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ name: '', slug: '', default_seats: 1 });

  const load = () => api.get('/api/admin/products').then(setProducts);
  useEffect(() => {
    load().catch(() => {});
  }, []);

  if (selected) return <ProductDetail id={selected} onBack={() => { setSelected(null); load(); }} notify={notify} />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100">Products</h1>
        <Button onClick={() => setModal(true)}><Plus size={15} /> New product</Button>
      </div>

      {products.length === 0 && (
        <Card className="p-10 text-center text-zinc-500">
          <Package size={28} className="mx-auto mb-3 text-zinc-600" />
          No products yet. Create one to start issuing licenses.
        </Card>
      )}

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {products.map((p) => (
          <Card
            key={p.id}
            className="p-5 cursor-pointer hover:border-violet-700 transition-colors"
          >
            <div onClick={() => setSelected(p.id)}>
              <div className="flex items-center gap-2 mb-2">
                <Package size={16} className="text-violet-400" />
                <span className="font-semibold text-zinc-100">{p.name}</span>
              </div>
              <div className="text-xs text-zinc-500 space-y-1">
                <div>slug: <code className="text-zinc-400">{p.slug}</code></div>
                <div>{p.licenses} licenses · {p.versions} versions · default {p.default_seats} seat{p.default_seats > 1 ? 's' : ''}</div>
                <div>{p.webhook_url ? <Pill color="violet">webhook on</Pill> : <Pill>no webhook</Pill>}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="New product">
        <div className="space-y-4">
          <Input label="Name" placeholder="My Awesome App" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Slug (goes inside license keys)" placeholder="my-awesome-app" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <Input label="Default seats per license" type="number" min="1" value={form.default_seats} onChange={(e) => setForm({ ...form, default_seats: e.target.value })} />
          <Button
            className="w-full justify-center"
            onClick={async () => {
              try {
                await api.post('/api/admin/products', form);
                setModal(false);
                setForm({ name: '', slug: '', default_seats: 1 });
                notify('Product created');
                load();
              } catch (e) {
                notify(e.message, true);
              }
            }}
          >
            Create product
          </Button>
        </div>
      </Modal>
    </div>
  );
}
