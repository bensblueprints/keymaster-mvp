import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { KeyRound, MonitorSmartphone, Package, Download } from 'lucide-react';
import { api } from '../api.js';
import { Card } from '../components/ui.jsx';

function Stat({ icon: Icon, label, value, sub, i }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
      <Card className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-lg bg-violet-500/10 text-violet-400">
            <Icon size={18} />
          </div>
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>
        </div>
        <div className="text-3xl font-bold text-zinc-100">{value}</div>
        {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
      </Card>
    </motion.div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get('/api/admin/stats').then(setStats).catch(() => {});
  }, []);
  if (!stats) return <div className="text-zinc-500">Loading…</div>;

  const max = Math.max(1, ...stats.days.map((d) => d.activations));
  const total30 = stats.days.reduce((a, d) => a + d.activations, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Dashboard</h1>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat i={0} icon={KeyRound} label="Licenses" value={stats.licenses} sub={`${stats.revoked} revoked`} />
        <Stat i={1} icon={MonitorSmartphone} label="Active seats" value={stats.active_seats} />
        <Stat i={2} icon={Package} label="Products" value={stats.products} />
        <Stat i={3} icon={Download} label="Downloads" value={stats.downloads} />
      </div>
      <Card className="p-5">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-300">Activations — last 30 days</h2>
          <span className="text-xs text-zinc-500">{total30} total</span>
        </div>
        <div className="flex items-end gap-[3px] h-32">
          {stats.days.map((d) => (
            <div key={d.date} className="flex-1 group relative">
              <div
                className="w-full rounded-t bg-violet-600/70 group-hover:bg-violet-400 transition-colors"
                style={{ height: `${Math.max(3, (d.activations / max) * 100)}%`, minHeight: 3 }}
              />
              <div className="hidden group-hover:block absolute -top-8 left-1/2 -translate-x-1/2 bg-zinc-800 border border-zinc-700 text-[10px] px-2 py-0.5 rounded whitespace-nowrap z-10">
                {d.date}: {d.activations}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
