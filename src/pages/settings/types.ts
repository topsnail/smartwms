export type SettingsTabId =
  | "locations"
  | "units"
  | "staff"
  | "departments"
  | "reasons"
  | "sources"
  | "categories"
  | "partners"
  | "accounts"
  | "import-export";

export type SimpleNameType = Exclude<
  SettingsTabId,
  "staff" | "categories" | "partners" | "accounts" | "import-export"
>;

export type BaseRow = { id: number; name: string };

export type StaffRow = BaseRow & { role?: string | null };

export type CategoryRow = BaseRow & {
  parent_id?: number | null;
  description?: string | null;
};

export type PartnerRow = BaseRow & {
  invoice_info?: string | null;
  contact?: string | null;
  mailing_address?: string | null;
};

export type UserRole = "admin" | "warehouse_keeper" | "readonly" | "reporter";

export type UserRow = {
  id: number;
  username: string;
  display_name?: string | null;
  role: UserRole;
  disabled?: number | null;
  created_at?: string;
};

