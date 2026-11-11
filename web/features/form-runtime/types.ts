export type {
  RuntimeDataSource,
  RuntimeFormSchema,
  RuntimeSchemaField,
} from "../form-model/runtime-types";

export type AssociationRecord = {
  id: string;
  createdAt: string;
  data: Record<string, unknown>;
};

export type IdentityUser = {
  avatarUrl: string | null;
  id: string;
  displayName: string;
  jobNumber: string | null;
  sourceType: string;
  status: string;
  roles: string[];
};

export type IdentityRole = {
  id: string;
  name: string;
  sourceType: string;
  status: string;
};

export type RuntimeIdentityCatalog = {
  roles: IdentityRole[];
  users: IdentityUser[];
};
