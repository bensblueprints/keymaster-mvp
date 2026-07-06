import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Copy, Check } from 'lucide-react';

export function Card({ children, className = '' }) {
  return (
    <div className={`bg-zinc-900/70 border border-zinc-800 rounded-2xl ${className}`}>{children}</div>
  );
}

export function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-violet-600 hover:bg-violet-500 text-white',
    ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-300 border border-zinc-700',
    danger: 'bg-red-600/15 hover:bg-red-600/25 text-red-400 border border-red-900'
  };
  return (
    <button
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({ label, className = '', ...props }) {
  return (
    <label className="block">
      {label && <span className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</span>}
      <input
        className={`w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-violet-600 ${className}`}
        {...props}
      />
    </label>
  );
}

export function Modal({ open, onClose, title, children, wide }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className={`bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[85vh] overflow-y-auto`}
            initial={{ scale: 0.95, y: 10, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 10, opacity: 0 }}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
              <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200">
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Pill({ color = 'zinc', children }) {
  const map = {
    green: 'text-emerald-400 bg-emerald-500/10 border-emerald-800/60',
    red: 'text-red-400 bg-red-500/10 border-red-900/60',
    amber: 'text-amber-400 bg-amber-500/10 border-amber-800/60',
    violet: 'text-violet-400 bg-violet-500/10 border-violet-800/60',
    zinc: 'text-zinc-400 bg-zinc-500/10 border-zinc-700'
  };
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${map[color]}`}>
      {children}
    </span>
  );
}

export function CopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button
      title={label || 'Copy'}
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="text-zinc-500 hover:text-violet-400 transition-colors"
    >
      {done ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
    </button>
  );
}

export const maskKey = (k) => (k && k.length > 24 ? `${k.slice(0, 10)}…${k.slice(-6)}` : k);
