/**
 * Domain types — auth and RBAC (plan §7.2, §7.3).
 */

export type ProfileStatus = "ACTIVE" | "SUSPENDED" | "ANONYMIZED";

export type ProfileRead = {
  userId: string;
  email: string;
  displayName: string | null;
  collegeName: string | null;
  phoneE164: string | null;
  publicMemberCode: string;
  profileCompletedAt: string | null;
  status: ProfileStatus;
};

export type StaffAssignmentStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";

export type RoleRead = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isSuperadmin: boolean;
  permissions: string[];
};

export type StaffAssignmentRead = {
  id: string;
  userId: string;
  email: string | null;
  displayName: string | null;
  roleId: string;
  roleName: string;
  status: StaffAssignmentStatus;
  invitedAt: string;
  activatedAt: string | null;
  eventScopes: string[];
};

/** Fixed permission catalog codes (plan §7.3). */
export const PERMISSION_CODES = [
  "admin.access",
  "staff.manage",
  "role.manage",
  "content.event.read",
  "content.event.write",
  "content.event.publish",
  "content.event.price.write",
  "content.event.capacity.write",
  "content.schedule.write",
  "content.notice.write",
  "content.sponsor.write",
  "content.merchandise.read",
  "content.merchandise.write",
  "support.read",
  "support.resolve",
  "registration.read",
  "registration.export",
  "finance.read",
  "refund.create",
  "refund.approve",
  "payment.reconcile",
  "scanner.use",
  "scanner.supervise",
  "scanner.device.manage",
  "pass.revoke",
  "pass.reissue",
  "audit.read",
  "feature_flag.write",
  "discount.manage",
] as const;


export type PermissionCode = (typeof PERMISSION_CODES)[number];
