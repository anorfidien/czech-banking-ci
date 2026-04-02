import { cn, SEVERITY_COLORS } from '../utils';

export default function SeverityBadge({ severity }: { severity: number }) {
  const style = SEVERITY_COLORS[severity] || SEVERITY_COLORS[2];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest',
        style.bg,
        style.text
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full', style.dot)} />
      {style.label}
    </span>
  );
}
