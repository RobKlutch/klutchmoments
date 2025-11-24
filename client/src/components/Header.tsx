import { Button } from "@/components/ui/button";
import { Menu, Sun, Moon, LogOut, User } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import klutchLogo from "@assets/logo white_1757726855246.png";

interface HeaderProps {
  onThemeToggle?: () => void;
  isDark?: boolean;
}

export default function Header({ onThemeToggle, isDark = false }: HeaderProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { user, logoutMutation } = useAuth();
  const [, setLocation] = useLocation();

  const handleSignIn = () => {
    setLocation("/auth");
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <div className="flex items-center">
          <img 
            src={klutchLogo} 
            alt="Klutch logo" 
            className="h-7 md:h-8 w-auto cursor-pointer" 
            data-testid="img-logo-header"
            onClick={() => setLocation("/")}
          />
        </div>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <a href="#how-it-works" className="text-sm font-medium hover:text-primary transition-colors">
            How It Works
          </a>
          <a href="#features" className="text-sm font-medium hover:text-primary transition-colors">
            Features
          </a>
          <a href="#pricing" className="text-sm font-medium hover:text-primary transition-colors">
            Pricing
          </a>
        </nav>

        {/* Right side buttons */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onThemeToggle}
            data-testid="button-theme-toggle"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          
          {user ? (
            <>
              {/* Admin Creator Access - only show for admin users */}
              {user.role === 'admin' && (
                <Button 
                  variant="default" 
                  onClick={() => setLocation("/admin/creator")}
                  className="hidden sm:flex"
                  data-testid="button-admin-creator"
                >
                  ADMIN
                </Button>
              )}
              
              <div className="hidden sm:flex items-center gap-2 text-sm">
                <User className="h-4 w-4" />
                <span>Welcome, {user.username}</span>
              </div>
              <Button 
                variant="outline" 
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
                className="hidden sm:flex"
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4 mr-2" />
                {logoutMutation.isPending ? "Signing out..." : "Sign Out"}
              </Button>
            </>
          ) : (
            <>
              <Button 
                variant="outline" 
                onClick={handleSignIn}
                className="hidden sm:flex" 
                data-testid="button-sign-in"
              >
                Sign In
              </Button>
              
              <Button 
                onClick={() => document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' })}
                data-testid="button-create-highlight"
              >
                Create a Highlight
              </Button>
            </>
          )}

          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            data-testid="button-mobile-menu"
          >
            <Menu className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Mobile Navigation */}
      {isMenuOpen && (
        <div className="md:hidden border-t bg-background p-4">
          <nav className="flex flex-col gap-4">
            <a href="#how-it-works" className="text-sm font-medium hover:text-primary transition-colors">
              How It Works
            </a>
            <a href="#features" className="text-sm font-medium hover:text-primary transition-colors">
              Features
            </a>
            <a href="#pricing" className="text-sm font-medium hover:text-primary transition-colors">
              Pricing
            </a>
            <div className="pt-2 border-t">
              {user ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4" />
                    <span>Welcome, {user.username}</span>
                  </div>
                  {/* Admin Creator Access - mobile */}
                  {user.role === 'admin' && (
                    <Button 
                      variant="default" 
                      onClick={() => setLocation("/admin/creator")}
                      className="w-full mb-2"
                      data-testid="button-mobile-admin-creator"
                    >
                      Admin Creator
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    onClick={handleLogout}
                    disabled={logoutMutation.isPending}
                    className="w-full"
                    data-testid="button-mobile-logout"
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    {logoutMutation.isPending ? "Signing out..." : "Sign Out"}
                  </Button>
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  onClick={handleSignIn}
                  className="w-full mb-2" 
                  data-testid="button-mobile-sign-in"
                >
                  Sign In
                </Button>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}