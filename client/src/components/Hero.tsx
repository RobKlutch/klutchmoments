import { Button } from "@/components/ui/button";

const klutchLogo = "/logo-hero.png";

export default function Hero() {
  const handleMakeMyMoment = () => {
    // Always go to auth page - it will redirect authenticated users appropriately
    window.location.href = '/auth';
  };

  const handleSeeExamples = () => {
    console.log('See examples clicked');
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-800 via-gray-900 to-black">
      <div className="container max-w-7xl mx-auto px-4 text-center">
        
        {/* Klutch Logo */}
        <div className="flex justify-center mb-8">
          <img 
            src={klutchLogo} 
            alt="Klutch" 
            className="w-28 md:w-32 lg:w-36 h-auto brightness-0 invert"
            data-testid="img-klutch-logo"
          />
        </div>
        
        {/* Main Headline */}
        <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold text-white mb-8" data-testid="heading-hero-main">
          Moments Matter.
        </h1>
        
        {/* Subheadline */}
        <p className="text-xl md:text-2xl lg:text-3xl text-gray-200 mb-12 max-w-4xl mx-auto" data-testid="heading-hero-sub">
          Turn any sports clip into a spotlight highlight in seconds.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Button 
            size="lg" 
            className="text-lg px-8 py-6 bg-yellow-400 text-black font-bold hover:bg-yellow-500 rounded-full min-w-[200px]"
            onClick={handleMakeMyMoment}
            data-testid="button-make-my-moment"
          >
            Make My Moment
          </Button>
          
          <Button 
            variant="outline" 
            size="lg" 
            className="text-lg px-8 py-6 bg-transparent border-2 border-white text-white font-semibold hover:bg-white hover:text-black rounded-full min-w-[200px]"
            onClick={handleSeeExamples}
            data-testid="button-see-examples"
          >
            See Examples
          </Button>
        </div>
      </div>
    </section>
  );
}