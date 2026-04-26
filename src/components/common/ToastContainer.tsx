import { useEffect } from 'react';
import { useToastStore, TOAST_DURATION, type ToastType } from '../../store/toast-store';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';

const typeStyles: Record<ToastType, string> = {
  success: 'border-emerald-500/24 bg-emerald-500/10 text-emerald-50',
  error: 'border-red-500/24 bg-red-500/10 text-red-50',
  info: 'border-sky-500/24 bg-sky-500/10 text-sky-50',
  warning: 'border-amber-500/24 bg-amber-500/10 text-amber-50',
};

const typeIcons: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 shrink-0" />,
  error: <XCircle className="w-4 h-4 shrink-0" />,
  info: <Info className="w-4 h-4 shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 shrink-0" />,
};

function ToastItem({ id, type, message, duration = TOAST_DURATION.DEFAULT }: {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}) {
  const remove = useToastStore((s) => s.remove);

  useEffect(() => {
    const timer = setTimeout(() => remove(id), duration);
    return () => clearTimeout(timer);
  }, [id, duration, remove]);

  return (
    <div className={cn(
      "flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm font-medium shadow-[var(--color-shadow-soft)] backdrop-blur-xl animate-slideIn",
      typeStyles[type]
    )}>
      {typeIcons[type]}
      <span className="flex-1 leading-snug">{message}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 p-0 text-current/70 hover:text-current hover:bg-transparent"
        onClick={() => remove(id)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div className="fixed bottom-6 right-4 flex flex-col gap-2.5 z-[9999] max-w-[380px]">
      {toasts.map((t) => (
        <ToastItem key={t.id} {...t} />
      ))}
    </div>
  );
}
