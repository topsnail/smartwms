import React from "react";

export function PageHeader(props: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const { title, subtitle, icon, actions, className } = props;

  return (
    <div className={["flex flex-col sm:flex-row sm:items-end justify-between gap-3", className].filter(Boolean).join(" ")}>
      <div className="flex items-end gap-3">
        <h2 className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {subtitle ? <p className="text-slate-500 text-xs sm:text-sm">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}

