import React from "react";
import { Download, Package } from "lucide-react";
import { Button, Modal, Table, message } from "antd";
import Papa from "papaparse";
import { notifyError } from "../../utils/notify";
import { useAuth } from "../../contexts/AuthContext";
import { downloadWithAuth } from "../../api/download";
import { apiClient } from "../../api/client";
import { batchImportMaterials, type SaveMaterialInput } from "../../api/materials";

export function ImportExportPanel() {
  const { can } = useAuth();
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [backupLoading, setBackupLoading] = React.useState(false);

  const parseCsvToMaterials = React.useCallback(
    (text: string): { materials: SaveMaterialInput[]; errors: { line: number; message: string }[] } => {
      const mapHeader = (raw: string): keyof SaveMaterialInput | null => {
        const h = String(raw || "").replace(/\uFEFF/g, "").trim();
        switch (h) {
          case "物料编码":
          case "编码":
          case "code":
            return "code";
          case "物料名称":
          case "名称":
          case "name":
            return "name";
          case "规格型号":
          case "规格":
          case "spec":
            return "spec";
          case "单位":
          case "unit":
            return "unit";
          case "分类":
          case "category":
            return "category";
          case "来源":
          case "source":
            return "source";
          case "购价":
          case "purchase_price":
            return "purchase_price";
          case "售价":
          case "sale_price":
            return "sale_price";
          case "图片URL":
          case "图片":
          case "image_url":
            return "image_url";
          default:
            return null;
        }
      };

      const toText = (v: unknown): string => String(v ?? "").replace(/\r/g, "").trim();
      const toOptText = (v: unknown): string | undefined => {
        const s = toText(v);
        return s ? s : undefined;
      };
      const toOptNumber = (v: unknown): number | undefined => {
        const s = toText(v);
        if (!s) return undefined;
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0) return undefined;
        return n;
      };

      const parsed = Papa.parse<Record<string, unknown>>(text, {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => {
          const mapped = mapHeader(h);
          return mapped ? String(mapped) : "__ignore__";
        },
      });

      const errors: { line: number; message: string }[] = [];
      if (parsed.errors?.length) {
        for (const e of parsed.errors.slice(0, 20)) {
          errors.push({ line: (e.row ?? 0) + 2, message: e.message || "CSV 解析错误" });
        }
      }

      const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");
      const materials: SaveMaterialInput[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Record<string, unknown>;
        // Papa 的 row 是 data 行索引（从 0 开始），加上 header 行（1）= +2
        const line = i + 2;

        const name = toText(row.name);
        if (!name) {
          // 空行/无效行直接跳过（不计为错误），避免用户末尾多空行导致“失败很多”
          const maybeAny = ["code", "spec", "unit", "category", "source", "purchase_price", "sale_price", "image_url"]
            .some((k) => toText(row[k]) !== "");
          if (maybeAny) errors.push({ line, message: "缺少必填字段：名称" });
          continue;
        }

        const purchase_price = toOptNumber(row.purchase_price);
        const sale_price = toOptNumber(row.sale_price);
        if (toText(row.purchase_price) && purchase_price == null) errors.push({ line, message: "购价必须为非负数字" });
        if (toText(row.sale_price) && sale_price == null) errors.push({ line, message: "售价必须为非负数字" });

        const m: SaveMaterialInput = {
          code: toOptText(row.code),
          name,
          spec: toOptText(row.spec),
          unit: toOptText(row.unit),
          category: toOptText(row.category),
          source: toOptText(row.source),
          purchase_price,
          sale_price,
          image_url: toOptText(row.image_url),
        };
        materials.push(m);
      }

      return { materials, errors };
    },
    []
  );

  const [importing, setImporting] = React.useState(false);
  const [importProgress, setImportProgress] = React.useState<{ done: number; total: number } | null>(null);

  const handleDownloadMaterialTemplate = React.useCallback(() => {
    const header = "物料编码,物料名称,规格型号,单位,分类,来源,购价,售价,图片URL";
    const example = "M-001,示例物料,规格A,个,分类名,自购,10.5,12.5,";
    const blob = new Blob(["\uFEFF" + header + "\n" + example], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "物料导入模板.csv";
    a.click();
    window.URL.revokeObjectURL(url);
    message.success("模板已下载");
  }, []);

  const handleBackup = async () => {
    setBackupLoading(true);
    try {
      message.info("正在准备备份，请稍候...");
      await downloadWithAuth("/api/backup", `wms_backup_${new Date().toISOString().slice(0, 10)}_${Date.now()}.sql`);
      message.success("数据库备份已成功下载，请妥善保存备份文件");
    } catch (error: any) {
      notifyError(error?.message || "备份失败，请稍后重试");
    } finally {
      setBackupLoading(false);
    }
  };

  const handleExport = async (key: string, url: string, filename: string) => {
    setExporting(key);
    try {
      await downloadWithAuth(url, filename);
      message.success("导出成功");
    } catch (err: any) {
      notifyError(err?.message || "导出失败");
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-6">
      {can("backup") && (
        <div className="bg-slate-50 p-6 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h4 className="font-bold mb-1">数据库备份</h4>
            <div className="text-xs text-slate-500">
              建议定期下载备份文件并离线保存（例如每周一次）。
            </div>
          </div>
          <Button type="primary" size="small" onClick={handleBackup} loading={backupLoading}>
            {backupLoading ? "备份中..." : "备份数据库"}
          </Button>
        </div>
      )}

      <div className="bg-slate-50 p-6 rounded-xl">
        <h4 className="font-bold mb-4">数据导出</h4>
        <div className="text-xs text-slate-500 mb-4">
          说明：出入库记录导出默认最多返回 5000 条（建议先筛选日期范围/关键字）。备份为逻辑 SQL，备份期间若仍有写入操作，可能出现跨表不一致，建议在低峰期执行。
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(can("export") || can("export_transactions")) && (
            <Button
              type="default"
              disabled={exporting !== null}
              onClick={() =>
                handleExport(
                  "transactions",
                  "/api/export/transactions",
                  `出入库记录_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.csv`
                )
              }
              className="!h-auto !p-4 !flex items-center gap-3 !text-slate-800 !text-left !border-slate-200"
              icon={<Download size={24} className="text-indigo-600" />}
            >
              <div>
                <div className="font-medium">出入库记录</div>
                <div className="text-xs text-slate-500">导出为CSV格式</div>
              </div>
            </Button>
          )}
          {(can("export") || can("export_operation_logs")) && (
            <Button
              type="default"
              disabled={exporting !== null}
              onClick={() =>
                handleExport(
                  "operation-logs",
                  "/api/export/operation-logs",
                  `操作日志_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.csv`
                )
              }
              className="!h-auto !p-4 !flex items-center gap-3 !text-slate-800 !text-left !border-slate-200"
              icon={<Download size={24} className="text-indigo-600" />}
            >
              <div>
                <div className="font-medium">操作日志</div>
                <div className="text-xs text-slate-500">导出为CSV格式</div>
              </div>
            </Button>
          )}
          {(can("export") || can("export_materials")) && (
            <Button
              type="default"
              disabled={exporting !== null}
              onClick={() =>
                handleExport(
                  "materials",
                  "/api/export/materials",
                  `物料信息_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.csv`
                )
              }
              className="!h-auto !p-4 !flex items-center gap-3 !text-slate-800 !text-left !border-slate-200"
              icon={<Download size={24} className="text-indigo-600" />}
            >
              <div>
                <div className="font-medium">物料信息</div>
                <div className="text-xs text-slate-500">导出为CSV格式</div>
              </div>
            </Button>
          )}
          {(can("export") || can("export_inventory")) && (
            <Button
              type="default"
              disabled={exporting !== null}
              onClick={() =>
                handleExport(
                  "inventory",
                  "/api/export/inventory",
                  `库存数据_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.csv`
                )
              }
              className="!h-auto !p-4 !flex items-center gap-3 !text-slate-800 !text-left !border-slate-200"
              icon={<Download size={24} className="text-indigo-600" />}
            >
              <div>
                <div className="font-medium">库存数据</div>
                <div className="text-xs text-slate-500">导出为CSV格式</div>
              </div>
            </Button>
          )}
        </div>
      </div>

      <div className="bg-slate-50 p-6 rounded-xl">
        <h4 className="font-bold mb-4">数据导入</h4>
        <div className="space-y-4">
          {can("materials_import") && (
            <div className="border border-dashed border-slate-300 rounded-lg p-6 text-center">
              <div className="mb-4">
                <Package size={48} className="mx-auto text-slate-400" />
              </div>
              <h5 className="font-medium mb-2">导入物料信息</h5>
              <p className="text-xs text-slate-500 mb-4">
                支持CSV格式文件，包含物料编码、名称、规格、单位、分类、来源、购价、售价等信息
              </p>
              <Button type="link" size="small" onClick={handleDownloadMaterialTemplate} className="!text-indigo-600 mb-4">
                下载 CSV 模板
              </Button>
              <div className="mb-4 text-xs text-slate-600">
                <div className="font-medium mb-1">CSV文件格式示例：</div>
                <div className="bg-white p-2 rounded border border-slate-200">
                  编码,名称,规格,单位,分类,来源,购价,售价
                  <br />
                  M001,螺丝,M6×20,个,紧固件,供应商A,0.5,1.0
                  <br />
                  M002,螺母,M6,个,紧固件,供应商B,0.3,0.6
                </div>
              </div>
              <input
                type="file"
                accept=".csv"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    // 允许重复选择同一文件
                    e.currentTarget.value = "";

                    if (importing) return;
                    setImporting(true);
                    setImportProgress(null);
                    message.info("正在解析 CSV，请稍候...");
                    const text = await file.text();
                    const { materials, errors } = parseCsvToMaterials(text);
                    if (errors.length) {
                      Modal.warning({
                        title: "CSV 格式或数据存在问题",
                        content: (
                          <div className="max-h-72 overflow-auto text-sm">
                            <div className="mb-2 text-slate-600">
                              已发现 <b>{errors.length}</b> 个问题（仅展示前 20 个）：
                            </div>
                            {errors.slice(0, 20).map((x, i) => (
                              <div key={i} className="mb-1">
                                第 <b>{x.line}</b> 行：{x.message}
                              </div>
                            ))}
                          </div>
                        ),
                      });
                    }

                    if (materials.length === 0) {
                      notifyError("文件中没有有效的物料数据");
                      return;
                    }
                    const preview = materials.slice(0, 30);
                    await new Promise<void>((resolve, reject) => {
                      Modal.confirm({
                        title: "导入预览",
                        content: (
                          <div className="space-y-3">
                            <div className="text-sm text-slate-600">
                              共解析到 <b>{materials.length}</b> 条物料，确认后将分批提交导入。
                            </div>
                            <div className="max-h-56 overflow-auto border border-slate-200 rounded-md">
                              <Table
                                size="small"
                                pagination={false}
                                rowKey={(_, i) => String(i)}
                                dataSource={preview}
                                columns={[
                                  { title: "名称", dataIndex: "name", ellipsis: true },
                                  { title: "编码", dataIndex: "code", width: 110, ellipsis: true },
                                  { title: "单位", dataIndex: "unit", width: 70 },
                                  { title: "来源", dataIndex: "source", width: 90, ellipsis: true },
                                ]}
                              />
                            </div>
                            {materials.length > 30 ? (
                              <div className="text-xs text-slate-500">仅展示前 30 条，导入时将提交全部。</div>
                            ) : null}
                          </div>
                        ),
                        okText: "确认导入",
                        cancelText: "取消",
                        onOk: () => resolve(),
                        onCancel: () => reject(new Error("cancel")),
                      });
                    });

                    // 分批提交，避免一次性请求体过大/失败成本高
                    const chunkSize = 300;
                    const total = materials.length;
                    let ok = 0;
                    let fail = 0;
                    const failedItems: { item: SaveMaterialInput; error: string }[] = [];

                    for (let i = 0; i < total; i += chunkSize) {
                      const chunk = materials.slice(i, i + chunkSize);
                      setImportProgress({ done: Math.min(i, total), total });
                      const res = await batchImportMaterials(chunk);
                      ok += res.successCount || 0;
                      fail += res.failedCount || 0;
                      if (Array.isArray(res.failedItems)) failedItems.push(...res.failedItems);
                    }
                    setImportProgress({ done: total, total });

                    message.success(`导入完成：成功 ${ok} 个，失败 ${fail} 个`);
                    if (fail > 0) {
                      Modal.info({
                        title: "导入失败项（前 20 条）",
                        content: (
                          <div className="max-h-72 overflow-auto">
                            {failedItems.slice(0, 20).map((x, i) => (
                              <div key={i} className="text-sm mb-2">
                                <b>{x.item?.name || "未命名"}</b>：{x.error}
                              </div>
                            ))}
                          </div>
                        ),
                      });
                    }
                  } catch (err: any) {
                    if (String(err?.message) === "cancel") return;
                    notifyError(err?.message || "导入失败，请稍后重试");
                  } finally {
                    setImporting(false);
                    setImportProgress(null);
                  }
                }}
                className="hidden"
                id="material-import"
              />
              <label
                htmlFor="material-import"
                className="btn-primary inline-block cursor-pointer"
              >
                {importing && importProgress ? `导入中 ${importProgress.done}/${importProgress.total}` : "选择CSV文件"}
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

