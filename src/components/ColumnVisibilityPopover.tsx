import React from "react";
import { Button, Checkbox, Popover, Space } from "antd";
import { SettingOutlined } from "@ant-design/icons";

export function ColumnVisibilityPopover(props: {
  title?: string;
  allKeys: { key: string; label: React.ReactNode }[];
  visibleKeys: string[];
  onToggle: (key: string, checked: boolean) => void;
  onReset?: () => void;
  buttonText?: string;
}) {
  const { title = "列显示", allKeys, visibleKeys, onToggle, onReset, buttonText = "列显隐" } = props;

  const content = (
    <div className="min-w-[220px] max-w-[320px]" onClick={(e) => e.stopPropagation()}>
      <div className="max-h-72 overflow-auto pr-1">
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          {allKeys.map((c) => (
            <Checkbox key={c.key} checked={visibleKeys.includes(c.key)} onChange={(e) => onToggle(c.key, e.target.checked)}>
              {c.label}
            </Checkbox>
          ))}
        </Space>
      </div>
      {onReset ? (
        <div className="pt-2 mt-2 border-t border-slate-200 flex justify-end">
          <Button size="small" onClick={onReset}>
            恢复默认
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <Popover placement="bottomRight" title={title} content={content} trigger="click">
      <Button icon={<SettingOutlined />}>{buttonText}</Button>
    </Popover>
  );
}

