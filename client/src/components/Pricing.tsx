import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

interface PricingPlan {
  id: string;
  name: string;
  price: string;
  description: string;
  features: string[];
  popular?: boolean;
  buttonText: string;
}

export default function Pricing() {
  const plans: PricingPlan[] = [
    {
      id: 'free',
      name: 'Free',
      price: '$0',
      description: '1 Highlight Video',
      features: [
        'Basic highlight creation',
        'Standard quality (720p)',
        'Klutch Moments watermark',
        'Limited editing options'
      ],
      buttonText: 'Get Started'
    },
    {
      id: 'single',
      name: 'Single Video',
      price: '$5.99',
      description: '1 Highlight Video',
      features: [
        'Professional highlight creation',
        'High quality (1080p)',
        'Remove watermark option',
        'Advanced editing features',
        'Priority processing'
      ],
      buttonText: 'Get Started'
    },
    {
      id: 'bundle5',
      name: '5 Videos',
      price: '$24.99',
      description: '5 Highlight Videos',
      features: [
        'Everything in Single Video',
        'Save $5 vs individual videos',
        'Bulk upload capability',
        '6 months to use credits',
        'Team sharing features'
      ],
      buttonText: 'Get Started'
    },
    {
      id: 'bundle15',
      name: '15 Videos',
      price: '$59.99',
      description: '15 Highlight Videos',
      features: [
        'Everything in 5 Videos',
        'Save $30 vs individual videos',
        'Season-long highlight package',
        '12 months to use credits',
        'Coach dashboard access',
        'Custom team branding'
      ],
      popular: true,
      buttonText: 'Get Started'
    }
  ];

  const handlePlanSelect = (planId: string) => {
    // TODO: Implement plan selection and payment flow
    console.log(`Selected plan: ${planId}`);
  };

  return (
    <section className="py-8 sm:py-12 lg:py-16 px-4 bg-background">
      <div className="container mx-auto max-w-7xl">
        <div className="text-center mb-8 sm:mb-12">
          <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-display font-bold mb-4">
            Choose Your Plan
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
            Select the perfect package for your highlight creation needs. All plans include our professional AI-powered tracking technology.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 max-w-6xl mx-auto">
          {plans.map((plan) => (
            <Card 
              key={plan.id} 
              className={`relative p-4 sm:p-6 hover-elevate transition-all duration-300 ${
                plan.popular ? 'border-primary shadow-lg sm:scale-105' : ''
              }`}
              data-testid={`pricing-card-${plan.id}`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                  <Badge className="bg-primary text-primary-foreground px-3 sm:px-4 py-1 text-xs sm:text-sm">
                    Most Popular
                  </Badge>
                </div>
              )}

              <div className="text-center mb-4 sm:mb-6">
                <h3 className="text-lg sm:text-xl font-semibold mb-2">{plan.name}</h3>
                <div className="mb-2">
                  <span className="text-3xl sm:text-4xl font-bold text-primary">{plan.price}</span>
                </div>
                <p className="text-muted-foreground text-xs sm:text-sm">{plan.description}</p>
              </div>

              <div className="space-y-2 sm:space-y-3 mb-4 sm:mb-6">
                {plan.features.map((feature, index) => (
                  <div key={index} className="flex items-start gap-2 text-xs sm:text-sm">
                    <Check className="w-3 h-3 sm:w-4 sm:h-4 text-primary flex-shrink-0 mt-0.5" />
                    <span className="leading-relaxed">{feature}</span>
                  </div>
                ))}
              </div>

              <Button 
                className={`w-full ${plan.popular ? 'bg-primary hover:bg-primary/90' : ''}`}
                variant={plan.popular ? 'default' : 'outline'}
                onClick={() => handlePlanSelect(plan.id)}
                data-testid={`button-select-${plan.id}`}
              >
                {plan.buttonText}
              </Button>
            </Card>
          ))}
        </div>

        {/* Value Proposition */}
        <div className="mt-16 text-center">
          <div className="bg-muted/30 rounded-lg p-8 max-w-4xl mx-auto">
            <h3 className="text-2xl font-semibold mb-4">Why Choose Klutch Moments?</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">🎯</span>
                </div>
                <h4 className="font-medium mb-2">AI-Powered Tracking</h4>
                <p className="text-sm text-muted-foreground">Our advanced AI keeps your spotlight perfectly centered on the player throughout the entire highlight.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">⚡</span>
                </div>
                <h4 className="font-medium mb-2">Lightning Fast</h4>
                <p className="text-sm text-muted-foreground">Get your professional highlight reel ready in under 60 seconds. No waiting, no delays.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                  <span className="text-2xl">📱</span>
                </div>
                <h4 className="font-medium mb-2">Social Ready</h4>
                <p className="text-sm text-muted-foreground">Instantly optimized for Instagram, TikTok, Twitter, and all major social platforms.</p>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-16">
          <h3 className="text-2xl font-semibold text-center mb-8">Frequently Asked Questions</h3>
          <div className="max-w-3xl mx-auto space-y-4">
            <Card className="p-4">
              <h4 className="font-medium mb-2">What sports are supported?</h4>
              <p className="text-sm text-muted-foreground">Klutch Moments works with all sports including basketball, soccer, football, volleyball, tennis, baseball, and more.</p>
            </Card>
            <Card className="p-4">
              <h4 className="font-medium mb-2">How long can my video be?</h4>
              <p className="text-sm text-muted-foreground">Upload videos up to 10 minutes long. We'll help you create the perfect 12-15 second highlight from your footage.</p>
            </Card>
            <Card className="p-4">
              <h4 className="font-medium mb-2">Do credits expire?</h4>
              <p className="text-sm text-muted-foreground">5 Video packages expire after 6 months, 15 Video packages expire after 12 months. Free and Single Video options don't have expiration.</p>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}