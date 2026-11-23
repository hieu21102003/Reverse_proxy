import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import '../public/playground.js';

/**
 * Phase B3 — form đăng ký + màn đổi mật khẩu + trang duyệt admin.
 * Helper thuần test không cần DOM; phần gắn DOM kiểm bằng đọc source
 * (cùng mẫu với tests/document-catalog-ui.test.ts).
 */

interface FileHelpers {
  passwordPairErrorKey: (password: unknown, confirm: unknown) => string | null;
  validateRegistration: (input: unknown) => string | null;
  registerErrorKey: (status: number, code: string | null) => string;
  loginErrorKey: (status: number, code: string | null) => string;
  changePasswordErrorKey: (status: number, code: string | null) => string;
  adminErrorKey: (status: number, code: string | null) => string;
  isAdminUser: (user: unknown) => boolean;
  roleOptionsForUser: (user: unknown) => string[];
}

const helpers = (globalThis as unknown as { __smartrailFileHelpers: FileHelpers }).__smartrailFileHelpers;

const validRegistration = {
  username: 'nguyen.van.a',
  password: 'mat-khau-kho-doan-123',
  passwordConfirm: 'mat-khau-kho-doan-123',
  displayName: 'Nguyễn A',
  fullName: 'Nguyễn Văn A',
  organization: 'Viện Đường sắt',
  email: 'a@example.com'
};

describe('validateRegistration — kiểm tra form đăng ký phía client', () => {
  it('dữ liệu hợp lệ -> null', () => {
    expect(helpers.validateRegistration(validRegistration)).toBeNull();
  });

  it('username sai luật (ngắn/dài/khoảng trắng/@) -> regUsernameInvalid', () => {
    for (const username of ['ab', 'a'.repeat(51), 'co khoang trang', 'a@b', '']) {
      expect(helpers.validateRegistration({ ...validRegistration, username }), username).toBe('regUsernameInvalid');
    }
  });

  it('email sai định dạng -> regEmailInvalid', () => {
    for (const email of ['khong-phai-email', 'a@b', 'a b@c.vn', '']) {
      expect(helpers.validateRegistration({ ...validRegistration, email }), email).toBe('regEmailInvalid');
    }
  });

  it('thiếu họ tên thật -> regFullNameRequired', () => {
    expect(helpers.validateRegistration({ ...validRegistration, fullName: '  ' })).toBe('regFullNameRequired');
    expect(helpers.validateRegistration({ ...validRegistration, fullName: '' })).toBe('regFullNameRequired');
  });

  it('mật khẩu ngắn/dài/không khớp -> khóa tương ứng', () => {
    expect(helpers.validateRegistration({ ...validRegistration, password: 'ngan', passwordConfirm: 'ngan' })).toBe('regPasswordShort');
    const long = 'x'.repeat(129);
    expect(helpers.validateRegistration({ ...validRegistration, password: long, passwordConfirm: long })).toBe('regPasswordLong');
    expect(helpers.validateRegistration({ ...validRegistration, passwordConfirm: 'khac-han-123' })).toBe('regPasswordMismatch');
  });

  it('đầu vào rác -> lỗi username (không throw)', () => {
    expect(helpers.validateRegistration(null)).toBe('regUsernameInvalid');
    expect(helpers.validateRegistration(undefined)).toBe('regUsernameInvalid');
    expect(helpers.validateRegistration({})).toBe('regUsernameInvalid');
  });
});

describe('passwordPairErrorKey — dùng chung cho đăng ký + đổi mật khẩu', () => {
  it('hợp lệ -> null; biên 8 và 128 ký tự đều qua', () => {
    expect(helpers.passwordPairErrorKey('12345678', '12345678')).toBeNull();
    const max = 'y'.repeat(128);
    expect(helpers.passwordPairErrorKey(max, max)).toBeNull();
  });

  it('ngắn/dài/không khớp', () => {
    expect(helpers.passwordPairErrorKey('1234567', '1234567')).toBe('regPasswordShort');
    expect(helpers.passwordPairErrorKey('y'.repeat(129), 'y'.repeat(129))).toBe('regPasswordLong');
    expect(helpers.passwordPairErrorKey('abcdefgh', 'abcdefgi')).toBe('regPasswordMismatch');
    expect(helpers.passwordPairErrorKey(null, null)).toBe('regPasswordShort');
  });
});

describe('registerErrorKey — map mã ổn định của POST /auth/register', () => {
  it('map đủ các mã của elib A3', () => {
    expect(helpers.registerErrorKey(409, 'USERNAME_TAKEN')).toBe('regUsernameTaken');
    expect(helpers.registerErrorKey(409, 'EMAIL_TAKEN')).toBe('regEmailTaken');
    expect(helpers.registerErrorKey(400, 'INVALID_USERNAME')).toBe('regUsernameInvalid');
    expect(helpers.registerErrorKey(400, 'PASSWORD_TOO_SHORT')).toBe('regPasswordShort');
    expect(helpers.registerErrorKey(400, 'PASSWORD_TOO_LONG')).toBe('regPasswordLong');
    expect(helpers.registerErrorKey(400, 'PASSWORD_TOO_COMMON')).toBe('regPasswordCommon');
    expect(helpers.registerErrorKey(400, 'PASSWORD_EQUALS_IDENTITY')).toBe('regPasswordIdentity');
    expect(helpers.registerErrorKey(429, 'PENDING_LIMIT_REACHED')).toBe('regPendingLimit');
    expect(helpers.registerErrorKey(429, 'RATE_LIMITED')).toBe('regRateLimited');
    expect(helpers.registerErrorKey(429, null)).toBe('regRateLimited');
    expect(helpers.registerErrorKey(400, 'INVALID_INPUT')).toBe('regInvalidInput');
    expect(helpers.registerErrorKey(500, null)).toBe('regFailed');
    expect(helpers.registerErrorKey(0, null)).toBe('regFailed');
  });

  it('PENDING_LIMIT_REACHED (429) không bị nhầm thành rate limit', () => {
    expect(helpers.registerErrorKey(429, 'PENDING_LIMIT_REACHED')).not.toBe('regRateLimited');
  });
});

describe('loginErrorKey — trạng thái đăng nhập', () => {
  it('pending/not-active chỉ lộ sau mật khẩu đúng; còn lại là lỗi chung', () => {
    expect(helpers.loginErrorKey(403, 'ACCOUNT_PENDING')).toBe('loginPending');
    expect(helpers.loginErrorKey(403, 'ACCOUNT_NOT_ACTIVE')).toBe('loginNotActive');
    expect(helpers.loginErrorKey(429, 'RATE_LIMITED')).toBe('loginRateLimited');
    expect(helpers.loginErrorKey(429, null)).toBe('loginRateLimited');
    // Sai mật khẩu + khóa tạm: elib trả chung 401 UNAUTHORIZED
    expect(helpers.loginErrorKey(401, 'UNAUTHORIZED')).toBe('elibLoginFailed');
    expect(helpers.loginErrorKey(500, null)).toBe('elibLoginFailed');
  });
});

describe('changePasswordErrorKey — đổi mật khẩu', () => {
  it('sai mật khẩu hiện tại (401) + chính sách mật khẩu mới', () => {
    expect(helpers.changePasswordErrorKey(401, 'UNAUTHORIZED')).toBe('changeWrongCurrent');
    expect(helpers.changePasswordErrorKey(400, 'PASSWORD_TOO_SHORT')).toBe('regPasswordShort');
    expect(helpers.changePasswordErrorKey(400, 'PASSWORD_TOO_COMMON')).toBe('regPasswordCommon');
    expect(helpers.changePasswordErrorKey(400, 'INVALID_INPUT')).toBe('regInvalidInput');
    expect(helpers.changePasswordErrorKey(500, null)).toBe('changeFailed');
  });
});

describe('adminErrorKey — map mã lỗi API quản trị', () => {
  it('map đủ các rào chắn của elib A3', () => {
    expect(helpers.adminErrorKey(400, 'INVALID_USER_TYPE')).toBe('adminErrUserType');
    expect(helpers.adminErrorKey(409, 'NOT_PENDING')).toBe('adminErrNotPending');
    expect(helpers.adminErrorKey(400, 'INVALID_REJECT_REASON')).toBe('adminErrRejectReason');
    expect(helpers.adminErrorKey(400, 'INVALID_STATUS_TRANSITION')).toBe('adminErrStatusTransition');
    expect(helpers.adminErrorKey(400, 'CANNOT_MODIFY_SELF')).toBe('adminErrSelf');
    expect(helpers.adminErrorKey(400, 'LAST_ADMIN')).toBe('adminErrLastAdmin');
    expect(helpers.adminErrorKey(400, 'EDITOR_REQUIRES_INTERNAL')).toBe('adminErrEditorInternal');
    expect(helpers.adminErrorKey(404, 'NOT_FOUND')).toBe('adminErrNotFound');
    expect(helpers.adminErrorKey(401, null)).toBe('adminErrLoginRequired');
    expect(helpers.adminErrorKey(403, null)).toBe('adminErrForbidden');
    expect(helpers.adminErrorKey(400, 'INVALID_INPUT')).toBe('regInvalidInput');
    expect(helpers.adminErrorKey(500, null)).toBe('adminErrFailed');
  });
});

describe('isAdminUser / roleOptionsForUser — hiển thị trang quản trị + luật editor', () => {
  it('chỉ admin mới thấy trang quản trị', () => {
    expect(helpers.isAdminUser({ role: 'admin' })).toBe(true);
    expect(helpers.isAdminUser({ role: 'editor' })).toBe(false);
    expect(helpers.isAdminUser({ role: 'viewer' })).toBe(false);
    expect(helpers.isAdminUser(null)).toBe(false);
    expect(helpers.isAdminUser(undefined)).toBe(false);
  });

  it('editor chỉ xuất hiện trong lựa chọn role cho người nội bộ', () => {
    expect(helpers.roleOptionsForUser({ user_type: 'internal' })).toEqual(['viewer', 'editor', 'admin']);
    expect(helpers.roleOptionsForUser({ user_type: 'external' })).toEqual(['viewer', 'admin']);
    expect(helpers.roleOptionsForUser({ user_type: null })).toEqual(['viewer', 'admin']);
    expect(helpers.roleOptionsForUser(null)).toEqual(['viewer', 'admin']);
  });
});

describe('gắn DOM: form đăng ký, đổi mật khẩu, trang duyệt admin', () => {
  const playgroundJs = readFileSync(new URL('../public/playground.js', import.meta.url), 'utf8');
  const indexHtml = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const playgroundCss = readFileSync(new URL('../public/playground.css', import.meta.url), 'utf8');

  const sliceBetween = (start: string, end: string) => {
    const from = playgroundJs.indexOf(start);
    const to = playgroundJs.indexOf(end, from);
    expect(from, start).toBeGreaterThanOrEqual(0);
    expect(to, end).toBeGreaterThan(from);
    return playgroundJs.slice(from, to);
  };

  it('form đăng ký đủ trường + honeypot ẩn ngoài màn hình (không display:none)', () => {
    for (const id of ['elib-register-form', 'reg-username', 'reg-email', 'reg-password', 'reg-password-confirm', 'reg-fullname', 'reg-displayname', 'reg-organization', 'reg-website']) {
      expect(indexHtml, id).toContain(`id="${id}"`);
    }
    expect(indexHtml).toContain('name="website"');
    expect(indexHtml).toContain('tabindex="-1"');
    expect(playgroundCss).toContain('.honeypot-field');
    expect(playgroundCss).toContain('left: -10000px');
    expect(playgroundCss).not.toMatch(/\.honeypot-field\s*\{[^}]*display:\s*none/);
  });

  it('đăng ký gửi đúng payload A3 (kèm honeypot), thành công hiện "chờ admin duyệt", không tự đăng nhập', () => {
    const handler = sliceBetween("$('#elib-register-form').addEventListener('submit'", "$('#elib-change-password-form')");
    expect(handler).toContain("elibFetchJson('/auth/register'");
    expect(handler).toContain('website:');
    expect(handler).toContain('validateRegistration(input)');
    expect(handler).toContain('registerErrorKey(result.status');
    expect(handler).toContain("t('regSuccess')");
    expect(handler).toContain('result.status === 201');
    expect(playgroundJs).toContain('Đã gửi đăng ký, vui lòng chờ admin duyệt.');
    // Không tự đăng nhập: handler đăng ký không gọi loadDocumentsView như login
    expect(handler).not.toContain('loadDocumentsView');
  });

  it('đăng nhập gửi identifier (email hoặc username) và map lỗi theo mã ổn định', () => {
    const handler = sliceBetween("$('#elib-login-form').addEventListener('submit'", "$('#elib-logout-btn')");
    expect(handler).toContain('identifier:');
    expect(handler).toContain('loginErrorKey(result.status');
    expect(handler).not.toContain('email: $');
  });

  it('mustChangePassword: chỉ hiện màn đổi mật khẩu trong mục Tài liệu', () => {
    const loader = sliceBetween('async function loadDocumentsView()', 'function updateDropzoneDisplay()');
    expect(loader).toContain('elibUser.mustChangePassword');
    expect(loader).toContain("$('#elib-change-password-box').hidden = false");
    const handler = sliceBetween("$('#elib-change-password-form').addEventListener('submit'", '// ---- Init from URL ----');
    expect(handler).toContain("elibFetchJson('/auth/change-password'");
    expect(handler).toContain('changePasswordErrorKey(result.status');
    expect(handler).toContain('passwordPairErrorKey');
  });

  it('trang quản trị chỉ hiện cho admin; menu có badge số chờ duyệt', () => {
    expect(indexHtml).toContain('id="nav-admin-users"');
    expect(indexHtml).toContain('id="nav-pending-count"');
    expect(indexHtml).toContain('id="view-admin-users"');
    const header = sliceBetween('function renderHeaderAuth()', 'async function refreshElibAuth()');
    expect(header).toContain('isAdminUser(elibUser)');
    expect(playgroundJs).toContain('refreshPendingBadge()');
    expect(playgroundJs).toContain("elibFetchJson('/admin/users?status=pending')");
  });

  it('duyệt bắt buộc chọn user_type; từ chối cần lý do; gợi ý tên miền công ty', () => {
    const pending = sliceBetween('function renderPendingUser(user)', 'function renderManagedUser(user)');
    expect(pending).toContain('approveBtn.disabled = true');
    expect(pending).toContain('typeSelect.value');
    expect(pending).toContain('/approve`');
    expect(pending).toContain('user_type: typeSelect.value');
    expect(pending).toContain('adminRejectReasonRequired');
    expect(pending).toContain('email_domain_internal');
    expect(pending).toContain("t('adminInternalEmailHint')");
  });

  it('quản lý người dùng: đổi role/user_type, vô hiệu hóa, đặt lại mật khẩu hiện 1 lần, mở khóa', () => {
    const managed = sliceBetween('function renderManagedUser(user)', 'async function loadAdminUsersView()');
    expect(managed).toContain('roleOptionsForUser(user)');
    expect(managed).toContain("method: 'PATCH'");
    expect(managed).toContain('reset-password');
    expect(managed).toContain('temporaryPassword');
    expect(managed).toContain("$('#temp-password-modal').hidden = false");
    expect(managed).toContain('unlock');
    expect(indexHtml).toContain('id="temp-password-modal"');
    expect(indexHtml).toContain('id="temp-password-value"');
    expect(playgroundJs).toContain('chỉ hiển thị một lần duy nhất');
    // Đóng modal thì xóa mật khẩu tạm khỏi DOM
    expect(playgroundJs).toContain("$('#temp-password-value').textContent = ''");
  });

  it('từ chối hàng loạt dùng checkbox + endpoint bulk-reject', () => {
    expect(playgroundJs).toContain("adminAction('/admin/users/bulk-reject'");
    expect(playgroundJs).toContain('.admin-pending-check');
    expect(playgroundJs).toContain('adminSelectUserFirst');
  });

  it('auth/me đọc userType/status/mustChangePassword từ elibUser', () => {
    expect(playgroundJs).toContain('elibUser = result.payload.user');
    expect(playgroundJs).toContain('mustChangePassword');
    expect(playgroundJs).toContain('isAdminUser(elibUser)');
  });
});
