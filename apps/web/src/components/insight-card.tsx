interface InsightCardProps {
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'critical';
  recommendation?: string;
}

const icons: Record<string, string> = {
  info: '💡',
  warning: '⚠️',
  critical: '🚨',
};

export function InsightCard({ title, body, severity, recommendation }: InsightCardProps) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="text-lg">{icons[severity]}</span>
        <div>
          <p className="font-medium text-gray-800">{title}</p>
          <p className="text-sm text-gray-600 mt-1">{body}</p>
          {recommendation && (
            <p className="text-xs text-brand-600 mt-2 italic">→ {recommendation}</p>
          )}
        </div>
      </div>
    </div>
  );
}
