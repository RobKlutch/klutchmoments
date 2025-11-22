import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { 
  Play, 
  ChevronRight, 
  Smartphone, 
  Clock, 
  Shield, 
  CheckCircle, 
  Upload, 
  Target, 
  Zap, 
  ArrowRight,
  Users,
  Trophy,
  Globe,
  Star,
  Eye
} from "lucide-react";
import {
  HERO_BACKGROUND_IMAGE,
  HERO_SPOTLIGHT_IMAGE,
  KLUTCH_LOGO_URL,
  SOCCER_SPOTLIGHT_IMAGE,
  VOLLEYBALL_SPOTLIGHT_IMAGE,
} from "@/constants/media";

interface SportAssets {
  original: string;
  spotlight: string;
  sport: string;
  description: string;
}

export default function Hero() {
  const [persona, setPersona] = useState<'athlete' | 'parent'>('athlete');
  const [activeSport, setActiveSport] = useState('basketball');
  const [spotlightEnabled, setSpotlightEnabled] = useState(true);

  const sportsAssets: Record<string, SportAssets> = {
    basketball: {
      original: HERO_BACKGROUND_IMAGE,
      spotlight: HERO_SPOTLIGHT_IMAGE,
      sport: 'Basketball',
      description: 'Amazing crossover and finish'
    },
    soccer: {
      original: HERO_BACKGROUND_IMAGE,
      spotlight: SOCCER_SPOTLIGHT_IMAGE,
      sport: 'Soccer',
      description: 'Goal-scoring run and shot'
    },
    volleyball: {
      original: HERO_BACKGROUND_IMAGE,
      spotlight: VOLLEYBALL_SPOTLIGHT_IMAGE,
      sport: 'Volleyball',
      description: 'Perfect spike technique'
    }
  };

  const personaContent = {
    athlete: {
      headline: "Turn any game clip into a recruiter-ready spotlight in 2 minutes",
      subheadline: "Upload a clip—Klutch auto-tracks your athlete, adds a clear spotlight, and exports vertical for social and recruiters",
      valueProps: [
        { icon: Clock, text: "Share-ready in 2 minutes", color: "text-green-400" },
        { icon: Target, text: "Auto tracking + vertical export", color: "text-blue-400" },
        { icon: Zap, text: "Zero editing skills needed", color: "text-purple-400" }
      ],
      primaryCTA: "Create a Highlight",
      trustMessage: "Trusted by 50K+ athletes who want their best plays to get the recognition they deserve"
    },
    parent: {
      headline: "Get your athlete noticed by coaches and recruiters faster",
      subheadline: "Simple upload—Klutch automatically creates coach-ready highlights that stand out in recruiting emails",
      valueProps: [
        { icon: Shield, text: "Coach-approved format", color: "text-green-400" },
        { icon: Eye, text: "Perfect for recruiting emails", color: "text-blue-400" },
        { icon: CheckCircle, text: "No editing experience required", color: "text-purple-400" }
      ],
      primaryCTA: "Create Highlight for My Athlete",
      trustMessage: "Trusted by families and coaches who want great plays to get the exposure they deserve"
    }
  };

  const handleGetStarted = () => {
    console.log('Create highlight clicked');
    document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleWatchDemo = () => {
    console.log('Watch demo clicked');
    // todo: remove mock functionality - would open demo video
  };

  const currentContent = personaContent[persona];
  const currentAsset = sportsAssets[activeSport];

  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden bg-gradient-to-br from-slate-900 via-black to-slate-800">
      {/* Athletes Showcase Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute inset-0">
          <img
            src={HERO_BACKGROUND_IMAGE}
            alt="Three athletes with AI spotlight effects"
            className="w-full h-full object-cover opacity-50"
            data-testid="img-hero-background"
          />
        </div>
        {/* Dark Wash Gradient Overlay for Text Readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black/90" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50" />
      </div>

      {/* Logo Overlay */}
      <div className="absolute top-6 left-6 md:top-8 md:left-8 z-10">
        <img
          src={KLUTCH_LOGO_URL}
          alt="Klutch logo"
          className="w-36 md:w-44 h-auto drop-shadow-2xl"
          data-testid="img-logo-hero"
        />
      </div>

      {/* Main Hero Content */}
      <div className="relative z-10 container px-4 text-white w-full">
        <div className="max-w-7xl mx-auto">
          
          {/* Persona Toggle - Top Right */}
          <div className="flex justify-end mb-8">
            <div className="flex bg-black/30 backdrop-blur-sm rounded-lg p-1 border border-white/20">
              <button
                onClick={() => setPersona('athlete')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  persona === 'athlete' 
                    ? 'bg-primary text-white shadow-md' 
                    : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
                data-testid="toggle-persona-athlete"
              >
                For Athletes
              </button>
              <button
                onClick={() => setPersona('parent')}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                  persona === 'parent' 
                    ? 'bg-primary text-white shadow-md' 
                    : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
                data-testid="toggle-persona-parent"
              >
                For Parents
              </button>
            </div>
          </div>

          {/* Desktop Layout: Left Content, Right Demo */}
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            
            {/* Left Column: Headlines & Content */}
            <div className="space-y-8">
              
              {/* Outcome-First Headlines */}
              <div className="space-y-6">
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-tight text-white" data-testid="heading-hero-main">
                  {currentContent.headline}
                </h1>
                
                <h2 className="text-lg md:text-xl lg:text-2xl text-gray-200 leading-relaxed max-w-2xl" data-testid="heading-hero-sub">
                  {currentContent.subheadline}
                </h2>
              </div>

              {/* Value Props */}
              <div className="space-y-4">
                {currentContent.valueProps.map((prop, index) => (
                  <div key={index} className="flex items-center gap-3" data-testid={`value-prop-${index}`}>
                    <prop.icon className={`w-5 h-5 ${prop.color}`} />
                    <span className="text-gray-200 font-medium">{prop.text}</span>
                  </div>
                ))}
              </div>

              {/* CTAs */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-4">
                  <Button 
                    size="lg" 
                    className="text-lg bg-gradient-to-r from-green-500 to-blue-600 text-white font-semibold shadow-xl"
                    onClick={handleGetStarted}
                    data-testid="button-create-highlight"
                  >
                    {currentContent.primaryCTA}
                    <ChevronRight className="w-5 h-5 ml-2" />
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    size="lg" 
                    className="text-lg bg-white/10 backdrop-blur-sm border-white/30 text-white"
                    onClick={handleWatchDemo}
                    data-testid="button-watch-demo"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    Watch 45-Second Demo
                  </Button>
                </div>
                
                {/* Risk Reducer */}
                <p className="text-green-300 font-medium flex items-center gap-2" data-testid="text-risk-reducer">
                  <Shield className="w-4 h-4" />
                  Free preview — no credit card required
                </p>
              </div>

              {/* Trust Message */}
              <p className="text-gray-300 text-sm leading-relaxed" data-testid="text-trust-message">
                {currentContent.trustMessage}
              </p>
            </div>

            {/* Right Column: Interactive Demo */}
            <div className="space-y-6">
              
              {/* Sports Tabs */}
              <div className="flex justify-center">
                <Tabs value={activeSport} onValueChange={setActiveSport} className="w-full max-w-md">
                  <TabsList className="grid grid-cols-3 bg-black/30 border border-white/20" data-testid="sports-tabs">
                    <TabsTrigger value="basketball" data-testid="tab-basketball">Basketball</TabsTrigger>
                    <TabsTrigger value="soccer" data-testid="tab-soccer">Soccer</TabsTrigger>
                    <TabsTrigger value="volleyball" data-testid="tab-volleyball">Volleyball</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Interactive Before/After Demo */}
              <Card className="bg-black/40 backdrop-blur-sm border-white/20 p-6" data-testid="interactive-demo">
                
                {/* Spotlight Toggle */}
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <Target className="w-5 h-5 text-yellow-400" />
                    <span className="text-white font-medium">AI Spotlight</span>
                  </div>
                  <button
                    onClick={() => setSpotlightEnabled(!spotlightEnabled)}
                    className={`px-4 py-2 rounded-md text-sm font-semibold transition-all border ${
                      spotlightEnabled 
                        ? 'bg-yellow-400 text-black border-yellow-400 shadow-md' 
                        : 'bg-yellow-400/20 text-yellow-400 border-yellow-400/30 hover:bg-yellow-400/30'
                    }`}
                    data-testid="toggle-spotlight"
                  >
                    {spotlightEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>

                {/* Before/After Comparison */}
                <div className="relative">
                  
                  {/* Video Demo Container */}
                  <div className="relative mx-auto max-w-[300px]" data-testid="demo-container">
                    
                    {/* Phone Frame */}
                    <div className="bg-gray-900 rounded-[2.5rem] p-3 shadow-2xl">
                      <div className="bg-black rounded-[2rem] overflow-hidden aspect-[9/16]">
                        
                        {/* Sports Demo Content */}
                        <div className="relative h-full">
                          <img 
                            src={spotlightEnabled ? currentAsset.spotlight : currentAsset.original}
                            alt={`${currentAsset.sport} - ${spotlightEnabled ? 'with AI spotlight' : 'original footage'}`}
                            className="w-full h-full object-cover transition-all duration-500"
                            data-testid="img-demo-content"
                          />
                          
                          {/* Spotlight Effect Overlays */}
                          {spotlightEnabled && (
                            <>
                              {/* Animated spotlight pulse */}
                              <div className="absolute inset-0 bg-gradient-to-r from-yellow-400/20 via-yellow-400/10 to-transparent animate-pulse" />
                              
                              {/* KLUTCH watermark */}
                              <div className="absolute top-3 right-3 bg-gradient-to-r from-blue-600 to-purple-600 px-2 py-1 rounded text-xs text-white font-bold tracking-wide shadow-lg">
                                KLUTCH
                              </div>
                              
                              {/* AI Spotlight indicator */}
                              <div className="absolute top-3 left-3 bg-yellow-500/90 backdrop-blur-sm px-2 py-1 rounded text-xs text-black font-bold flex items-center gap-1">
                                <Target className="w-3 h-3" />
                                AI SPOTLIGHT
                              </div>
                              
                              {/* Social Ready Badges */}
                              <div className="absolute bottom-16 left-3 right-3 flex gap-2">
                                <Badge variant="secondary" className="bg-green-500/90 text-white text-xs">
                                  9:16 Format
                                </Badge>
                                <Badge variant="secondary" className="bg-blue-500/90 text-white text-xs">
                                  Share Ready
                                </Badge>
                              </div>
                              
                              {/* Bottom caption area */}
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3">
                                <p className="text-white text-sm font-semibold mb-1">
                                  {persona === 'athlete' ? 'Your highlight!' : 'Your athlete\'s highlight!'}
                                </p>
                                <p className="text-gray-300 text-xs">
                                  {currentAsset.description} • Ready to share! #Klutch
                                </p>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Demo Status */}
                  <div className="text-center mt-4">
                    {spotlightEnabled ? (
                      <div className="space-y-2">
                        <p className="text-yellow-400 font-semibold flex items-center justify-center gap-2" data-testid="text-demo-result">
                          <Zap className="w-4 h-4" />
                          AI-powered spotlight effect active
                        </p>
                        <p className="text-gray-300 text-sm" data-testid="text-demo-time">
                          Processed in under 2 minutes • Perfect for social & recruiting
                        </p>
                      </div>
                    ) : (
                      <p className="text-gray-400 text-sm" data-testid="text-demo-original">
                        Original game footage
                      </p>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          </div>

          {/* Trust Indicators - Bottom */}
          <div className="mt-16 text-center">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 lg:gap-8 max-w-4xl mx-auto">
              <div className="text-center" data-testid="stat-speed">
                <div className="flex items-center justify-center mb-2">
                  <Clock className="w-6 h-6 text-green-400 mr-2" />
                  <span className="text-3xl font-bold text-green-400">2min</span>
                </div>
                <p className="text-sm text-gray-300">Avg processing</p>
              </div>
              <div className="text-center" data-testid="stat-highlights">
                <div className="flex items-center justify-center mb-2">
                  <Play className="w-6 h-6 text-blue-400 mr-2" />
                  <span className="text-3xl font-bold text-blue-400">500K+</span>
                </div>
                <p className="text-sm text-gray-300">Highlights created</p>
              </div>
              <div className="text-center" data-testid="stat-athletes">
                <div className="flex items-center justify-center mb-2">
                  <Users className="w-6 h-6 text-purple-400 mr-2" />
                  <span className="text-3xl font-bold text-purple-400">50K+</span>
                </div>
                <p className="text-sm text-gray-300">Athletes showcased</p>
              </div>
              <div className="text-center" data-testid="stat-quality">
                <div className="flex items-center justify-center mb-2">
                  <Smartphone className="w-6 h-6 text-pink-400 mr-2" />
                  <span className="text-3xl font-bold text-pink-400">100%</span>
                </div>
                <p className="text-sm text-gray-300">Social-ready</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 animate-bounce">
        <div className="w-6 h-10 border-2 border-white/50 rounded-full flex justify-center">
          <div className="w-1 h-3 bg-white/70 rounded-full mt-2 animate-pulse"></div>
        </div>
      </div>
    </section>
  );
}