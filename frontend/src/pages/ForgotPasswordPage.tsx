import animationSrc from "../animations/login.json?url";
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "../api/auth.api";
import { Alert } from "../components/Alert";
import { AuthLayout } from "../components/AuthLayout";
import { Button } from "../components/Button";
import { InputField } from "../components/InputField";
import { getErrorMessage } from "../utils/api-error";
import { validateEmail } from "../utils/validators";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");

  const reset = useMutation({
    mutationFn: authApi.resetPassword,
    onSuccess: () => {
      navigate("/reset-password", { state: { email: email.trim().toLowerCase() } });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = validateEmail(email);
    setEmailError(nextError);
    if (nextError) return;
    reset.mutate(email.trim().toLowerCase());
  }

  return (
    <AuthLayout
      animationSrc={animationSrc}
      animationSegment={[48, 200]}
      title="Forgot your password?"
      subtitle="We will email you a code so you can choose a new one."
      footer={
        <p>
          Remembered it? <Link to="/login">Back to log in</Link>
        </p>
      }
    >
      <form className="form" onSubmit={handleSubmit} noValidate>
        {reset.error ? <Alert tone="error" message={getErrorMessage(reset.error)} /> : null}
        <InputField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Enter your email address"
          value={email}
          onChange={setEmail}
          error={emailError}
        />
        <Button type="submit" loading={reset.isPending} fullWidth>
          Send code
        </Button>
      </form>
    </AuthLayout>
  );
}
