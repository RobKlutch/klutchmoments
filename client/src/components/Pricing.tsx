import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, Zap, Crown, Users, Gift, type LucideIcon } from "lucide-react";

interface PricingPlan {
  id: string;
  name: string;
  price: string;
  originalPrice?: string;
  description: string;
  features: string[];
  popular?: boolean;
  buttonText: string;
  icon: LucideIcon;
  savings?: string;
}

export default function Pricing() {
  const plans: PricingPlan[] = [
    {
      id: 'free',
      name: 'Free',
      price: '$0',
      description: 'Create your first highlight. Free.',
      icon: Gift,
      features: [
        '1 spotlight video',
        'Standard quality (720p)',
        'Basic spotlight effects'
      ],
      buttonText: 'Start Free'
    },
    {
      id: 'single',
      name: 'Single Video',
      price: '$5.99',
      description: 'Try the full Klutch experience on one highlight.',
      icon: Zap,
      features: [
        '1 spotlight video',
        'High quality (1080p)',
        'All spotlight effects',
        'Social media ready'
      ],
      buttonText: 'Get Started'
    },
    {
      id: 'bundle5',
      name: '5 Videos',
      price: '$24.99',
      originalPrice: '$29.95',
      description: 'Save $5 • Great for the season',
      icon: Crown,
      popular: true,
      savings: 'Save $5',
      features: [
        '5 spotlight videos',
        'Bulk upload capability',
        '6 months to use credits',
        'Custom branding options'
      ],
      buttonText: 'Most Popular'
    },
    {
      id: 'bundle15',
      name: '15 Videos',
      price: '$59.99',
      originalPrice: '$89.85',
      description: 'Save $30 • Full season package',
      icon: Users,
      savings: 'Save $30',
      features: [
        '15 spotlight videos',
        'Season-long coverage',
        '12 months to use credits',
        'Priority support'
      ],
      buttonText: 'Best Value'
    }
  ];

  const scrollToUpload = () => {
    document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handlePlanSelect = (planId: string) => {
    // TODO: Implement plan selection and payment flow
    console.log(`Selected plan: ${planId}`);
    scrollToUpload();
  };

  return (
    <section className="py-20 bg-muted/30" data-testid="section-pricing">
      <div className="container max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" data-testid="pricing-heading">
            Simple, Transparent Pricing
          </h2>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 max-w-6xl mx-auto">
          {plans.map((plan, index) => (
            <div key={plan.id} className="relative">
              {/* Popular Badge */}
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-10">
                  <Badge className="bg-primary text-primary-foreground px-4 py-1 text-sm font-semibold">
                    Most Popular
                  </Badge>
                </div>
              )}

              {/* Savings Badge */}
              {plan.savings && !plan.popular && (
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 z-10">
                  <Badge variant="secondary" className="px-3 py-1 text-xs font-semibold">
                    {plan.savings}
                  </Badge>
                </div>
              )}

              <Card 
                className={`p-6 h-full relative hover-elevate transition-all duration-300 ${
                  plan.popular ? 'border-primary shadow-lg lg:scale-105' : ''
                }`}
                data-testid={`pricing-card-${plan.id}`}
              >
                {/* Plan Header */}
                <div className="text-center mb-6">
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-primary/10 rounded-lg mb-4">
                    <plan.icon className="w-6 h-6 text-primary" aria-hidden="true" />
                  </div>
                  
                  <h3 className="text-xl font-bold mb-2" data-testid={`plan-${plan.id}-name`}>
                    {plan.name}
                  </h3>
                  
                  <div className="mb-3">
                    {plan.originalPrice && (
                      <div className="text-sm text-muted-foreground line-through mb-1">
                        {plan.originalPrice}
                      </div>
                    )}
                    <span className="text-3xl font-bold text-primary" data-testid={`plan-${plan.id}-price`}>
                      {plan.price}
                    </span>
                  </div>
                  
                  <p className="text-sm text-muted-foreground" data-testid={`plan-${plan.id}-description`}>
                    {plan.description}
                  </p>
                </div>

                {/* Features List */}
                <div className="space-y-3 mb-8 flex-grow">
                  {plan.features.map((feature, featureIndex) => (
                    <div 
                      key={featureIndex} 
                      className="flex items-start gap-3"
                      data-testid={`plan-${plan.id}-feature-${featureIndex}`}
                    >
                      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-green-100 dark:bg-green-950/20 flex items-center justify-center">
                        <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                      </div>
                      <span className="text-sm leading-relaxed">{feature}</span>
                    </div>
                  ))}
                </div>

                {/* CTA Button */}
                <Button 
                  variant={plan.popular ? 'default' : 'outline'}
                  size="lg"
                  className="w-full"
                  onClick={() => handlePlanSelect(plan.id)}
                  data-testid={`button-select-${plan.id}`}
                >
                  {plan.buttonText}
                </Button>
              </Card>
            </div>
          ))}
        </div>

        {/* Value Proposition */}
        <div className="mt-20">
          <div className="bg-background rounded-lg p-8 max-w-4xl mx-auto border shadow-sm">
            <h3 className="text-2xl font-bold text-center mb-8">Why Choose Klutch Moments?</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-6 h-6 text-primary" />
                </div>
                <h4 className="font-semibold mb-2">AI-Powered Tracking</h4>
                <p className="text-sm text-muted-foreground">Advanced AI keeps the spotlight perfectly centered on your player throughout the entire highlight.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Crown className="w-6 h-6 text-primary" />
                </div>
                <h4 className="font-semibold mb-2">Lightning Fast</h4>
                <p className="text-sm text-muted-foreground">Get your professional highlight reel ready in under 60 seconds. No waiting, no delays.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center mx-auto mb-4">
                  <Users className="w-6 h-6 text-primary" />
                </div>
                <h4 className="font-semibold mb-2">Social Ready</h4>
                <p className="text-sm text-muted-foreground">Instantly optimized for Instagram, TikTok, Twitter, and all major social platforms.</p>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ Link */}
        <div className="text-center mt-16">
          <p className="text-muted-foreground mb-6">
            Questions about pricing? Have a custom project?
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button 
              variant="outline" 
              size="lg"
              onClick={() => document.getElementById('faq-section')?.scrollIntoView({ behavior: 'smooth' })}
              data-testid="button-pricing-faq"
            >
              View FAQ
            </Button>
            <Button 
              variant="outline" 
              size="lg"
              onClick={scrollToUpload}
              data-testid="button-create-highlight"
            >
              Create a Highlight
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}