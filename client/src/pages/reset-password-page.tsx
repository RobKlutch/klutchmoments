import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Link, useLocation } from "wouter";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import klutchLogo from "@assets/klutch (2)_1757644634520.png";

export default function ResetPasswordPage() {
  const { resetPasswordMutation } = useAuth();
  const [, navigate] = useLocation();
  const [resetForm, setResetForm] = useState({ password: "", confirmPassword: "" });
  const [token, setToken] = useState<string | null>(null);
  const [isValidToken, setIsValidToken] = useState<boolean | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    if (tokenParam) {
      setToken(tokenParam);
      setIsValidToken(true);
    } else {
      setIsValidToken(false);
    }
  }, []);

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    
    if (resetForm.password !== resetForm.confirmPassword) {
      return;
    }

    resetPasswordMutation.mutate(
      { token, password: resetForm.password },
      {
        onSuccess: () => {
          setTimeout(() => navigate("/auth"), 2000);
        }
      }
    );
  };

  if (isValidToken === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (isValidToken === false) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <XCircle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <CardTitle>Invalid Reset Link</CardTitle>
            <CardDescription>
              This password reset link is invalid or has expired.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/auth">
              <Button className="w-full" data-testid="button-back-to-login">
                Back to Login
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (resetPasswordMutation.isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <CardTitle>Password Reset Successfully</CardTitle>
            <CardDescription>
              Your password has been reset. You will be redirected to login shortly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/auth">
              <Button className="w-full" data-testid="button-go-to-login">
                Go to Login
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Reset Form - Left side */}
      <div className="md:basis-[420px] md:shrink-0 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
              <div className="rounded-md px-3 py-2 bg-white/90 dark:bg-white/90">
                <img 
                  src={klutchLogo} 
                  alt="Klutch logo" 
                  className="w-40 md:w-48 h-auto" 
                  data-testid="img-logo-reset"
                />
              </div>
            </div>
            <h1 className="text-3xl font-display font-bold mb-2">Reset Password</h1>
            <p className="text-muted-foreground">Enter your new password below</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Create New Password</CardTitle>
              <CardDescription>Choose a strong password for your account</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={resetForm.password}
                    onChange={(e) => setResetForm(prev => ({ ...prev, password: e.target.value }))}
                    placeholder="Enter new password"
                    required
                    minLength={6}
                    data-testid="input-new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={resetForm.confirmPassword}
                    onChange={(e) => setResetForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                    placeholder="Confirm new password"
                    required
                    minLength={6}
                    data-testid="input-confirm-password"
                  />
                  {resetForm.confirmPassword && resetForm.password !== resetForm.confirmPassword && (
                    <p className="text-sm text-destructive">Passwords do not match</p>
                  )}
                </div>
                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={
                    resetPasswordMutation.isPending || 
                    !resetForm.password || 
                    resetForm.password !== resetForm.confirmPassword
                  }
                  data-testid="button-reset-password"
                >
                  {resetPasswordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Reset Password
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Hero Section - Right side */}
      <div className="md:flex-1 bg-gradient-to-br from-primary to-primary/80 p-4 sm:p-8 text-white flex items-center justify-center min-h-screen">
        <div className="max-w-lg text-center">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold mb-4 lg:mb-6">
            Secure Account Recovery
          </h2>
          <p className="text-lg lg:text-xl mb-6 lg:mb-8 text-white/90">
            Your account security is our priority. Complete the password reset to regain access to your highlights.
          </p>
          
          <div className="space-y-4 lg:space-y-6">
            <div className="flex items-center gap-3 lg:gap-4 bg-white/10 backdrop-blur-sm p-3 lg:p-4 rounded-lg">
              <CheckCircle className="w-6 h-6 lg:w-8 lg:h-8 flex-shrink-0" />
              <div className="text-left">
                <h3 className="font-semibold text-sm lg:text-base">Secure Reset Process</h3>
                <p className="text-xs lg:text-sm text-white/80">Your reset link is encrypted and time-limited</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 lg:gap-4 bg-white/10 backdrop-blur-sm p-3 lg:p-4 rounded-lg">
              <XCircle className="w-6 h-6 lg:w-8 lg:h-8 flex-shrink-0" />
              <div className="text-left">
                <h3 className="font-semibold text-sm lg:text-base">Password Protection</h3>
                <p className="text-xs lg:text-sm text-white/80">Choose a strong password to keep your account safe</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}