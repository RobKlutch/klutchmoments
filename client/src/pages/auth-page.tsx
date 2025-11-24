// Blueprint: javascript_auth_all_persistance - auth page implementation
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { insertUserSchema } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Redirect } from "wouter";
import { Loader2, Zap, Users, Upload, ArrowLeft } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { SiApple } from "react-icons/si";
import { Separator } from "@/components/ui/separator";
import klutchLogo from "@assets/klutch (2)_1757644634520.png";

export default function AuthPage() {
  const { user, loginMutation, registerMutation, forgotPasswordMutation } = useAuth();
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ email: "", password: "" });
  const [forgotPasswordForm, setForgotPasswordForm] = useState({ email: "" });
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  
  // Fetch OAuth configuration using React Query
  const { data: oauthConfig } = useQuery<{googleEnabled: boolean; appleEnabled: boolean}>({
    queryKey: ['/api/auth/config'],
    staleTime: 5 * 60 * 1000, // 5 minutes - cache config since it doesn't change often
    retry: 1,
  });

  // Redirect authenticated users based on role
  if (user) {
    // Admin users go directly to admin creator page
    if (user.role === 'admin' || user.role === 'super_admin') {
      window.location.href = '/admin/creator';
    } else {
      // Regular users go to upload workflow
      window.location.href = '/?step=upload';
    }
    return null;
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(loginForm);
  };

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    registerMutation.mutate(registerForm);
  };

  const handleForgotPassword = (e: React.FormEvent) => {
    e.preventDefault();
    forgotPasswordMutation.mutate(forgotPasswordForm);
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Auth Forms - Left side */}
      <div className="md:basis-[420px] md:shrink-0 flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-6">
              <div className="rounded-md px-3 py-2 bg-white/90 dark:bg-white/90">
                <img 
                  src={klutchLogo} 
                  alt="Klutch logo" 
                  className="w-40 md:w-48 h-auto" 
                  data-testid="img-logo-auth"
                />
              </div>
            </div>
            <h1 className="text-3xl font-display font-bold mb-2">Welcome Back</h1>
            <p className="text-muted-foreground">Create AI-powered professional highlights in seconds</p>
          </div>

          {showForgotPassword ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowForgotPassword(false)}
                    data-testid="button-back-to-login"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div>
                    <CardTitle>Reset Password</CardTitle>
                    <CardDescription>Enter your email to receive reset instructions</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">Email Address</Label>
                    <Input
                      id="forgot-email"
                      type="email"
                      value={forgotPasswordForm.email}
                      onChange={(e) => setForgotPasswordForm(prev => ({ ...prev, email: e.target.value }))}
                      placeholder="Enter your email address"
                      required
                      data-testid="input-forgot-email"
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full" 
                    disabled={forgotPasswordMutation.isPending}
                    data-testid="button-send-reset"
                  >
                    {forgotPasswordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Send Reset Instructions
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login" data-testid="tab-login">Login</TabsTrigger>
                <TabsTrigger value="register" data-testid="tab-register">Sign Up</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
              <Card>
                <CardHeader>
                  <CardTitle>Login</CardTitle>
                  <CardDescription>Enter your credentials to access your account</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(oauthConfig?.googleEnabled || oauthConfig?.appleEnabled) && (
                    <>
                      <div className="space-y-2">
                        {oauthConfig?.googleEnabled && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => window.location.href = '/api/auth/google'}
                            data-testid="button-google-login"
                          >
                            <FcGoogle className="mr-2 h-5 w-5" />
                            Continue with Google
                          </Button>
                        )}
                        {oauthConfig?.appleEnabled && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => window.location.href = '/api/auth/apple'}
                            data-testid="button-apple-login"
                          >
                            <SiApple className="mr-2 h-5 w-5" />
                            Continue with Apple
                          </Button>
                        )}
                      </div>

                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <Separator />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
                        </div>
                      </div>
                    </>
                  )}

                  <form onSubmit={handleLogin} className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        value={loginForm.email}
                        onChange={(e) => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                        required
                        data-testid="input-login-email"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="login-password">Password</Label>
                      <Input
                        id="login-password"
                        type="password"
                        value={loginForm.password}
                        onChange={(e) => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                        required
                        data-testid="input-login-password"
                      />
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={loginMutation.isPending}
                      data-testid="button-login"
                    >
                      {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Login
                    </Button>
                    <div className="text-center">
                      <Button
                        variant="ghost"
                        onClick={() => setShowForgotPassword(true)}
                        className="text-sm text-muted-foreground h-auto p-0"
                        data-testid="button-forgot-password"
                      >
                        Forgot your password?
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card>
                <CardHeader>
                  <CardTitle>Create Account</CardTitle>
                  <CardDescription>Join thousands of athletes showcasing their talent with AI-powered highlights</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(oauthConfig?.googleEnabled || oauthConfig?.appleEnabled) && (
                    <>
                      <div className="space-y-2">
                        {oauthConfig?.googleEnabled && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => window.location.href = '/api/auth/google'}
                            data-testid="button-google-register"
                          >
                            <FcGoogle className="mr-2 h-5 w-5" />
                            Continue with Google
                          </Button>
                        )}
                        {oauthConfig?.appleEnabled && (
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full"
                            onClick={() => window.location.href = '/api/auth/apple'}
                            data-testid="button-apple-register"
                          >
                            <SiApple className="mr-2 h-5 w-5" />
                            Continue with Apple
                          </Button>
                        )}
                      </div>

                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <Separator />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
                        </div>
                      </div>
                    </>
                  )}

                  <form onSubmit={handleRegister} className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="register-email">Email</Label>
                      <Input
                        id="register-email"
                        type="email"
                        value={registerForm.email}
                        onChange={(e) => setRegisterForm(prev => ({ ...prev, email: e.target.value }))}
                        required
                        data-testid="input-register-email"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="register-password">Password</Label>
                      <Input
                        id="register-password"
                        type="password"
                        value={registerForm.password}
                        onChange={(e) => setRegisterForm(prev => ({ ...prev, password: e.target.value }))}
                        required
                        data-testid="input-register-password"
                      />
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full" 
                      disabled={registerMutation.isPending}
                      data-testid="button-register"
                    >
                      {registerMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Create Account
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
            </Tabs>
          )}
        </div>
      </div>

      {/* Hero Section - Right side */}
      <div className="md:flex-1 bg-gradient-to-br from-primary to-primary/80 p-4 sm:p-8 text-white flex items-center justify-center min-h-screen">
        <div className="max-w-lg text-center">
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-display font-bold mb-4 lg:mb-6">
            Spotlight Your Talent. Get Noticed.
          </h2>
          <p className="text-lg lg:text-xl mb-6 lg:mb-8 text-white/90">
            Transform your game clips into professional highlight reels with AI-powered player tracking.
          </p>
          
          <div className="space-y-4 lg:space-y-6">
            <div className="flex items-center gap-3 lg:gap-4 bg-white/10 backdrop-blur-sm p-3 lg:p-4 rounded-lg">
              <Upload className="w-6 h-6 lg:w-8 lg:h-8 flex-shrink-0" />
              <div className="text-left">
                <h3 className="font-semibold text-sm lg:text-base">Upload Any Video</h3>
                <p className="text-xs lg:text-sm text-white/80">Raw game footage from phones, cameras, or streams</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 lg:gap-4 bg-white/10 backdrop-blur-sm p-3 lg:p-4 rounded-lg">
              <Users className="w-6 h-6 lg:w-8 lg:h-8 flex-shrink-0" />
              <div className="text-left">
                <h3 className="font-semibold text-sm lg:text-base">Select Your Player</h3>
                <p className="text-xs lg:text-sm text-white/80">AI automatically tracks and follows the action</p>
              </div>
            </div>
            
            <div className="flex items-center gap-3 lg:gap-4 bg-white/10 backdrop-blur-sm p-3 lg:p-4 rounded-lg">
              <Zap className="w-6 h-6 lg:w-8 lg:h-8 flex-shrink-0" />
              <div className="text-left">
                <h3 className="font-semibold text-sm lg:text-base">Share & Get Recruited</h3>
                <p className="text-xs lg:text-sm text-white/80">Professional highlights ready for social media</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}