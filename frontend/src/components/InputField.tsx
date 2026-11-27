import { useId, useState } from "react";

type InputFieldProps = {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
};

export function InputField({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  error,
  hint,
  disabled,
}: InputFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && visible ? "text" : type;

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={error ? "field-control field-control-error" : "field-control"}>
        <input
          id={id}
          className={isPassword ? "has-toggle" : undefined}
          name={name}
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? `${id}-description` : undefined}
          spellCheck={type === "email" ? false : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {isPassword ? (
          <button
            className="field-toggle"
            type="button"
            disabled={disabled}
            onClick={() => setVisible((current) => !current)}
            aria-label={visible ? "Hide password" : "Show password"}
            aria-pressed={visible}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
              <circle cx="12" cy="12" r="3" />
              {!visible ? <path d="m3 3 18 18" /> : null}
            </svg>
          </button>
        ) : null}
      </div>
      {error ? <p className="field-error" id={`${id}-description`}>{error}</p> : null}
      {!error && hint ? <p className="field-hint" id={`${id}-description`}>{hint}</p> : null}
    </div>
  );
}
