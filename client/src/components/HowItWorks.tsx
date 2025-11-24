import { Button } from "@/components/ui/button";
import { Upload, Target, Download } from "lucide-react";
import uploadImage from "@assets/upload_1760665296563.jpeg";
import selectImage from "@assets/select_1760665448753.jpeg";
import highlightImage from "@assets/highlight_1760665522407.jpeg";

interface Step {
  id: number;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  image?: string;
}

export default function HowItWorks() {
  const steps: Step[] = [
    {
      id: 1,
      title: "Upload Video",
      description: "Upload your sports clip in any format",
      icon: Upload,
      image: uploadImage
    },
    {
      id: 2,
      title: "Select Player", 
      description: "Click on the player you want to highlight",
      icon: Target,
      image: selectImage
    },
    {
      id: 3,
      title: "Get Highlight",
      description: "Download your spotlight highlight video",
      icon: Download,
      image: highlightImage
    }
  ];

  return (
    <section className="py-16 lg:py-24 bg-background" id="how-it-works">
      <div className="container px-4 mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-4" data-testid="heading-how-it-works">
            How It Works
          </h2>
        </div>

        <div className="grid md:grid-cols-3 gap-12 lg:gap-16 max-w-7xl mx-auto">
          {steps.map((step) => (
            <div key={step.id} className="text-center" data-testid={`step-${step.id}`}>
              {/* Step Number */}
              <div className="mb-6">
                <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl font-bold text-primary-foreground">
                    {step.id}
                  </span>
                </div>
              </div>

              {/* Step Icon */}
              <div className="mb-6">
                <div className="w-56 h-56 md:w-64 md:h-64 lg:w-72 lg:h-72 bg-muted rounded-lg flex items-center justify-center mx-auto overflow-hidden">
                  {step.image ? (
                    <img 
                      src={step.image} 
                      alt={step.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <step.icon className="w-12 h-12 text-primary" aria-hidden="true" />
                  )}
                </div>
              </div>

              {/* Step Content */}
              <div className="space-y-3">
                <h3 className="text-xl md:text-2xl font-bold" data-testid={`step-${step.id}-title`}>
                  {step.title}
                </h3>
                <p className="text-muted-foreground text-base md:text-lg" data-testid={`step-${step.id}-description`}>
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-16">
          <Button 
            size="lg"
            onClick={() => document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' })}
            data-testid="button-create-highlight"
          >
            Create a Highlight
          </Button>
        </div>
      </div>
    </section>
  );
}