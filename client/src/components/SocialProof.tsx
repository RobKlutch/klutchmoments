import { Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

interface Testimonial {
  quote: string;
  author: string;
  role: string;
  sport: string;
}

export default function SocialProof() {

  const testimonials: Testimonial[] = [
    {
      quote: "Klutch made my recruitment video in seconds. College scouts finally noticed my plays.",
      author: "Marcus J.",
      role: "High School Basketball",
      sport: "Basketball"
    },
    {
      quote: "Perfect for social media. My highlights look professional without any editing skills.",
      author: "Sarah M.",
      role: "Club Soccer",
      sport: "Soccer"
    },
    {
      quote: "Game-changer for our team content. Parents love seeing their kids highlighted.",
      author: "Coach Williams",
      role: "Youth Volleyball",
      sport: "Volleyball"
    }
  ];

  return (
    <section className="py-16 bg-muted/30" data-testid="section-social-proof">
      <div className="container max-w-6xl mx-auto px-4">

        {/* Testimonials */}
        <div className="text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-4" data-testid="testimonials-heading">
            Trusted by Athletes Everywhere
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            From high school to college recruiting, athletes choose Klutch to showcase their best moments.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {testimonials.map((testimonial, index) => (
            <Card 
              key={index}
              className="p-6 hover-elevate"
              data-testid={`testimonial-${index}`}
            >
              {/* Quote */}
              <div className="mb-4">
                <div className="flex mb-2">
                  <span className="sr-only">5 out of 5 stars</span>
                  {[...Array(5)].map((_, i) => (
                    <Star 
                      key={i} 
                      className="w-4 h-4 fill-yellow-400 text-yellow-400" 
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <p className="text-foreground leading-relaxed" data-testid={`testimonial-${index}-quote`}>
                  "{testimonial.quote}"
                </p>
              </div>

              {/* Author */}
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src="" alt={testimonial.author} />
                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-sm">
                    {testimonial.author.split(' ').map(n => n[0]).join('')}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-semibold text-sm" data-testid={`testimonial-${index}-author`}>
                    {testimonial.author}
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid={`testimonial-${index}-role`}>
                    {testimonial.role}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Trust Indicators */}
        <div className="mt-16 text-center">
          <p className="text-sm text-muted-foreground mb-6">
            Used by athletes at top programs nationwide
          </p>
          <div className="flex flex-wrap justify-center items-center gap-8 opacity-60">
            {/* Placeholder for school/program logos */}
            <div className="text-lg font-bold text-muted-foreground tracking-wide" data-testid="trust-badge-ncaa">NCAA D1</div>
            <div className="text-lg font-bold text-muted-foreground tracking-wide" data-testid="trust-badge-highschool">HIGH SCHOOL</div>
            <div className="text-lg font-bold text-muted-foreground tracking-wide" data-testid="trust-badge-club">CLUB SPORTS</div>
            <div className="text-lg font-bold text-muted-foreground tracking-wide" data-testid="trust-badge-youth">YOUTH LEAGUES</div>
          </div>
        </div>
      </div>
    </section>
  );
}