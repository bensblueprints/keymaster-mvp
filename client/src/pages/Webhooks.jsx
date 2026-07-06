import React, { useEffect, useState } from 'react';
import { Webhook, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { Card, Pill, Button } from '../components/ui.jsx';

export default function Webhooks() {
  const [rows, setRows] = useState([]);
  const load = () => api.get('/api/admin/webhook-deliveries').then(setRows);
  useEffect(() => {
    load().catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-2">
          <Webhook size={22} className="text-violet-400" /> Webhook deliveries
        </h1>
        <Button variant="ghost" onClick={() => load()}><RefreshCw size={14} /> Refresh</Button>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 border-b border-zinc-800">
              <th className="py-3 pl-5">Time</th><th>Product</th><th>Event</th><th>Status</th><th>Attempts</th><th className="pr-5">Payload / error</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-800/60 align-top">
                <td className="py-3 pl-5 text-zinc-500 text-xs whitespace-nowrap">{r.created_at}</td>
                <td className="text-zinc-300">{r.product_name}</td>
                <td><Pill color={r.event === 'activation' ? 'green' : r.event === 'deactivation' ? 'amber' : r.event === 'test' ? 'violet' : 'red'}>{r.event}</Pill></td>
                <td>
                  {r.status_code >= 200 && r.status_code < 300 ? (
                    <Pill color="green">{r.status_code}</Pill>
                  ) : r.status_code ? (
                    <Pill color="red">{r.status_code}</Pill>
                  ) : (
                    <Pill color="red">failed</Pill>
                  )}
                </td>
                <td className="text-zinc-400">{r.attempts}</td>
                <td className="pr-5">
                  <code className="text-[11px] text-zinc-500 break-all">{r.last_error || r.payload_json?.slice(0, 120)}</code>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="py-10 text-center text-zinc-500">No deliveries yet. Configure a webhook URL on a product.</td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
