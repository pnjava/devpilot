import { cn, healthColor } from '@/lib/utils';

interface AlertCardProps {
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  teamName?: string;
  issueKey?: string;
  createdAt: string;
  acknowledgedAt?: string | null;
  onAcknowledge?: () => void;
}

const severityStyles = {
  info: 'border-l-blue-400 bg-blue-50',
  warning: 'border-l-amber-400 bg-amber-50',
  critical: 'border-l-red-400 bg-red-50',
};

export function AlertCard({
  type,
  message,
  severity,
  teamName,
  issueKey,
  createdAt,
  acknowledgedAt,
  onAcknowledge,
}: AlertCardProps) {
  return (
    <div
      className={cn(
        'border-l-4 rounded-r-lg p-3 text-sm',
        severityStyles[severity],
        acknowledgedAt && 'opacity-60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-gray-800">
            {type.replace(/_/g, ' ')}
            {issueKey && <span className="ml-1 text-brand-600">[{issueKey}]</span>}
          </p>
          <p className="text-gray-600 mt-0.5">{message}</p>
          <div className="flex gap-3 mt-1 text-xs text-gray-400">
            {teamName && <span>{teamName}</span>}
            <span>{new Date(createdAt).toLocaleDateString()}</span>
          </div>
        </div>
        {!acknowledgedAt && onAcknowledge && (
          <button
            onClick={onAcknowledge}
            className="text-xs text-gray-500 hover:text-gray-800 underline whitespace-nowrap"
          >
            Acknowledge
          </button>
        )}
      </div>
    </div>
  );
}
