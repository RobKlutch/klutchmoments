import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";

interface FAQItem {
  question: string;
  answer: string;
}

export default function FAQ() {
  const faqs: FAQItem[] = [
    {
      question: "What sports does Klutch Moments support?",
      answer: "Klutch Moments works with all sports including basketball, soccer, football, volleyball, tennis, baseball, hockey, lacrosse, track and field, and more. Our AI is trained to detect and track players across all major sports."
    },
    {
      question: "How long can my video be?",
      answer: "You can upload videos up to 10 minutes long. Our AI will help you identify the best moments and create perfect 12-15 second highlights for social media sharing and recruiting purposes."
    },
    {
      question: "What video formats do you accept?",
      answer: "We accept all common video formats including MP4, MOV, AVI, and WebM. For best results, we recommend uploading videos in 1080p or higher resolution with good lighting and clear player visibility."
    },
    {
      question: "How does the AI player tracking work?",
      answer: "Our advanced AI technology automatically detects and tracks players throughout your video. Simply select the player you want to highlight, and our AI will keep them in the spotlight with professional-grade tracking that follows their every move."
    },
    {
      question: "Do I need any video editing experience?",
      answer: "Not at all! Klutch Moments is designed for everyone - from parents capturing youth sports to athletes building recruitment videos. Our AI handles all the technical work, so you can focus on showcasing great moments."
    },
    {
      question: "How long does it take to create a highlight?",
      answer: "Most highlights are ready in under 60 seconds. Processing time depends on video length and server load, but our optimized system ensures you get professional results quickly."
    },
    {
      question: "Can I remove the watermark?",
      answer: "Yes! Free previews include a Klutch watermark, but all paid plans (Single Video, 5 Videos, and 15 Videos) provide watermark-free downloads in full HD quality."
    },
    {
      question: "Do my video credits expire?",
      answer: "Yes, all video credits expire after 12 months, giving you plenty of time to use your highlights throughout the season."
    },
    {
      question: "What quality will my highlight be?",
      answer: "Free previews are available in 720p HD. All paid plans include full 1080p HD quality, and we're working on 4K support for the ultimate highlight experience."
    },
    {
      question: "Can I use highlights for college recruiting?",
      answer: "Absolutely! Our highlights are perfect for college recruiting. Many of our users have successfully used Klutch highlights in their recruiting packages. The professional quality and AI tracking help showcase skills effectively to coaches and scouts."
    },
    {
      question: "Is my video data secure?",
      answer: "Yes, your privacy and data security are our top priorities. We use enterprise-grade encryption, secure servers, and never share your videos without permission. You retain full ownership of your content."
    },
    {
      question: "Can I get a refund if I'm not satisfied?",
      answer: "We offer a 30-day satisfaction guarantee. If you're not happy with your highlights, contact our support team and we'll work to make it right or provide a full refund."
    },
    {
      question: "Do you offer team or bulk pricing?",
      answer: "Yes! Our 15 Video package is perfect for teams, and we offer custom solutions for larger organizations. Contact our sales team to discuss volume pricing and team management features."
    },
    {
      question: "How do I share my highlights?",
      answer: "Once created, you can instantly download your highlights and share them anywhere - Instagram, TikTok, Twitter, recruiting platforms, or send directly to coaches. All highlights are optimized for social media."
    }
  ];

  const scrollToUpload = () => {
    document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section id="faq-section" className="py-20 bg-background" data-testid="section-faq">
      <div className="container max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4" data-testid="faq-heading">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Got questions? We've got answers. Can't find what you're looking for? Reach out to our support team.
          </p>
        </div>

        {/* FAQ Accordion */}
        <Accordion type="single" collapsible className="space-y-4" data-testid="faq-accordion">
          {faqs.map((faq, index) => (
            <AccordionItem 
              key={index} 
              value={`item-${index}`}
              className="border rounded-lg px-6 hover-elevate"
              data-testid={`faq-item-${index}`}
            >
              <AccordionTrigger 
                className="text-left font-semibold hover:no-underline py-6"
                data-testid={`faq-question-${index}`}
              >
                {faq.question}
              </AccordionTrigger>
              <AccordionContent 
                className="text-muted-foreground leading-relaxed pb-6"
                data-testid={`faq-answer-${index}`}
              >
                {faq.answer}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        {/* Bottom CTA */}
        <div className="text-center mt-16">
          <div className="bg-muted/30 rounded-lg p-8">
            <h3 className="text-2xl font-bold mb-4">Ready to Create Your First Highlight?</h3>
            <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
              Start with our free preview and see how Klutch can transform your sports clips into professional highlights.
            </p>
            <Button 
              size="lg"
              onClick={scrollToUpload}
              data-testid="button-faq-create-highlight"
            >
              Create a Highlight
            </Button>
          </div>
        </div>

        {/* Contact Support */}
        <div className="text-center mt-12">
          <p className="text-sm text-muted-foreground">
            Still have questions?{" "}
            <a 
              href="mailto:support@klutchmoments.com" 
              className="text-primary hover:underline font-medium"
              data-testid="link-support-email"
            >
              Contact our support team
            </a>
            {" "}and we'll get back to you within 24 hours.
          </p>
        </div>
      </div>
    </section>
  );
}