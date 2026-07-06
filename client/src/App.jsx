import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyRound, LayoutDashboard, Package, Webhook, LogOut, Lock } from 'lucide-react';
import { api } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import Licenses from './pages/Licenses.jsx';
import Webhooks from './pages/Webhooks.jsx';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'licenses', label: 'Licenses', icon: KeyRound },
  { id: 'webhooks', label: 'Webhooks', icon: Webhook }
];

function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/admin/login', { password });
      onSuccess();
    } catch {
      setError('Wrong password');
    }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.form
        onSubmit={submit}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 w-full max-w-sm"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-xl bg-violet-500/15 text-violet-400">
            <KeyRound size={22} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-zinc-100">Keymaster</h1>
            <p className="text-xs text-zinc-500">License server admin</p>
          </div>
        </div>
        <label className="block mb-4">
          <span className="block text-xs font-medium text-zinc-400 mb-1.5">Admin password</span>
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-violet-600"
            />
          </div>
        </label>
        {error && <p className="text-xs text-red-400 mb-3">{error}</p>}
        <button className="w-full bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-2.5 text-sm font-semibold transition-colors">
          Sign in
        </button>
      </motion.form>
    </div>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);
  const [page, setPage] = useState('dashboard');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    api.get('/api/admin/me').then((d) => setAuthed(d.authed)).catch(() => setAuthed(false));
  }, []);

  const notify = (msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 2800);
  };

  if (authed === null) return null;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  const Page = { dashboard: Dashboard, products: Products, licenses: Licenses, webhooks: Webhooks }[page];

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 shrink-0 border-r border-zinc-800 bg-zinc-950 p-4 flex flex-col fixed inset-y-0">
        <div className="flex items-center gap-2.5 px-2 mb-8">
          <div className="p-2 rounded-lg bg-violet-500/15 text-violet-400">
            <KeyRound size={18} />
          </div>
          <span className="font-bold text-zinc-100">Keymaster</span>
        </div>
        <nav className="space-y-1 flex-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                page === id ? 'bg-violet-500/10 text-violet-300 font-medium' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </nav>
        <button
          onClick={async () => { await api.post('/api/admin/logout'); setAuthed(false); }}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60"
        >
          <LogOut size={16} /> Sign out
        </button>
      </aside>

      <main className="flex-1 ml-56 p-8 max-w-6xl">
        <Page notify={notify} />
      </main>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-xl border text-sm font-medium shadow-xl ${
              toast.isError
                ? 'bg-red-950 border-red-800 text-red-300'
                : 'bg-zinc-900 border-zinc-700 text-zinc-200'
            }`}
          >
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
