import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  icon?: string;
  defaultOpen?: boolean;
  badge?: string | number;
  children: ReactNode;
}

export default function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  badge,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
      >
        <span className="text-gray-400 text-xs select-none">{open ? "▾" : "▸"}</span>
        {icon && <span>{icon}</span>}
        <h3 className="text-lg font-semibold flex-1">{title}</h3>
        {badge !== undefined && (
          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-xs font-medium text-gray-600 dark:text-gray-300">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
