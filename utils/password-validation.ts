// Same password rules as app/auth/register.tsx: minimum length 6, confirm
// must match exactly. Returns error codes (not messages) so callers can map
// them to translated strings.

export type PasswordErrorCode = 'required' | 'tooShort' | 'mismatch';

export interface NewPasswordErrors {
  password?: PasswordErrorCode;
  confirm?: PasswordErrorCode;
}

export function validateNewPassword(password: string, confirm: string): NewPasswordErrors {
  const errors: NewPasswordErrors = {};
  if (!password) errors.password = 'required';
  else if (password.length < 6) errors.password = 'tooShort';

  if (!confirm) errors.confirm = 'required';
  else if (confirm !== password) errors.confirm = 'mismatch';

  return errors;
}
