import React from "react";
import { Download, Package } from "lucide-react";
import { Button, Modal, Table, message } from "antd";
import { notifyError } from "../../utils/notify";
import { useAuth } from "../../contexts/AuthContext";
import { downloadWithAuth } from "../../api/download";
import { apiClient } from "../../api/client";
import { batchImportMaterials, type SaveMaterialInput } from "../../api/materials";

export function ImportExportPanel() {
  const { can } = useAuth();
  const [exporting, setExporting] = React.useState<string | null>(null);
  const [backupLoading, setBackupLoading] = React.useState(false);

  const parseCsvToMaterials = React.useCallback((text: string): SaveMaterialInput[] => {
    const lines = text.split("\n").filter((line) => line.trim());
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.replace(/\"/g, "").trim());
    const materials: SaveMaterialInput[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.replace(/\"/g, "").trim());
      const material: SaveMaterialInput = {} as SaveMaterialInput;
      headers.forEach((header, index) => {
        const value = values[index];
        switch (header) {
          // 新模板
          case "物料编码":
          // 旧示例
          case "编码":
            material.code = value || undefined;
            break;
          case "物料名称":
          case "名称":
            material.name = value;
            break;
          case "规格型号":
          case "规格":
            material.spec = value || undefined;
            break;
          case "单位":
            material.unit = value || undefined;
            break;
          case "分类":
            material.category = value || undefined;
            break;
          case "来源":
            material.source = value || undefined;
            break;
          case "购价":
            material.purchase_price = value ? Number(value) : undefined;
            break;
          case "售价":
            material.sale_price = value ? Number(value) : undefined;
            break;
          case "图片URL":
          case "图片":
            material.image_url = value || undefined;
            break;
        }
      });
      if (material.name) materials.push(material);
    }
    return materials;
  }, []);

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
                    message.info("正在导入物料信息，请稍候...");
                    const text = await file.text();
                    const parsed = parseCsvToMaterials(text);
                    if (parsed.length === 0) {
                      notifyError("文件中没有有效的物料数据");
                      return;
                    }
                    const preview = parsed.slice(0, 30);
                    await new Promise<void>((resolve, reject) => {
                      Modal.confirm({
                        title: "导入预览",
                        content: (
                          <div className="space-y-3">
                            <div className="text-sm text-slate-600">
                              共解析到 <b>{parsed.length}</b> 条物料，确认后将提交导入。
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
                            {parsed.length > 30 ? (
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
                    const res = await batchImportMaterials(parsed);
                    message.success(`导入完成：成功 ${res.successCount} 个，失败 ${res.failedCount} 个`);
                    if (res.failedCount > 0) {
                      Modal.info({
                        title: "导入失败项（前 20 条）",
                        content: (
                          <div className="max-h-72 overflow-auto">
                            {res.failedItems.slice(0, 20).map((x, i) => (
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
                  }
                }}
                className="hidden"
                id="material-import"
              />
              <label
                htmlFor="material-import"
                className="btn-primary inline-block cursor-pointer"
              >
                选择CSV文件
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

