import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import AdminManagement from "@/components/AdminDashboard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";

export default function AdminPage() {
  const { user, isLoading } = useAuth();

  // Check if user has admin access
  const hasAdminAccess = user && (user.role === "admin" || user.role === "super_admin");

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-xl font-semibold mb-4">Authentication Required</h2>
          <p className="text-muted-foreground mb-6">
            Please log in to access the admin dashboard.
          </p>
          <Button asChild>
            <Link href="/auth">Log In</Link>
          </Button>
        </Card>
      </div>
    );
  }

  if (!hasAdminAccess) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-xl font-semibold mb-4">Access Denied</h2>
          <p className="text-muted-foreground mb-6">
            You don't have permission to access the admin dashboard.
          </p>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Home
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <div className="flex items-center gap-4">
            <Button asChild variant="ghost" size="sm">
              <Link href="/">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to App
              </Link>
            </Button>
            <div className="text-sm text-muted-foreground">
              Logged in as {user.username} ({user.role})
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container py-8">
        <AdminManagement userRole={user.role} />
      </main>
    </div>
  );
}