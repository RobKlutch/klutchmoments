const klutchLogo = "/logo-white.png";

export default function Footer() {
  return (
    <footer className="border-t bg-background">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Logo and Description */}
          <div className="flex flex-col items-center md:items-start gap-3">
            <img 
              src={klutchLogo} 
              alt="Klutch logo" 
              className="h-5 w-auto" 
              data-testid="img-logo-footer"
            />
            <p className="text-sm text-muted-foreground text-center md:text-left">
              AI-powered sports highlights for the next generation of athletes
            </p>
          </div>

          {/* Links */}
          <div className="flex flex-wrap justify-center md:justify-end gap-6 text-sm">
            <a href="/pricing" className="text-muted-foreground hover:text-foreground transition-colors">
              Pricing
            </a>
            <a href="#how-it-works" className="text-muted-foreground hover:text-foreground transition-colors">
              How It Works
            </a>
            <a href="#features" className="text-muted-foreground hover:text-foreground transition-colors">
              Features
            </a>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-6 pt-6 border-t text-center text-sm text-muted-foreground">
          © 2024 Klutch Moments. All rights reserved.
        </div>
      </div>
    </footer>
  );
}