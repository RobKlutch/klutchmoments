import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Share, Download, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

interface SocialSharingProps {
  videoUrl?: string;
  title?: string;
  description?: string;
  onDownload?: () => void;
}

interface SocialPlatform {
  id: string;
  name: string;
  color: string;
  icon: string;
  shareUrl: (params: { url: string; text: string; hashtags?: string }) => string;
  aspectRatio?: string;
  recommended?: boolean;
}

export default function SocialSharing({ 
  videoUrl = "",
  title = "Check out my amazing highlight!",
  description = "Created with Klutch Moments - Spotlight Your Talent. Get Noticed.",
  onDownload
}: SocialSharingProps) {
  const [isCopied, setIsCopied] = useState(false);
  const { toast } = useToast();

  const socialPlatforms: SocialPlatform[] = [
    {
      id: 'instagram',
      name: 'Instagram',
      color: 'bg-gradient-to-r from-purple-500 to-pink-500',
      icon: '📷',
      aspectRatio: '1:1 or 9:16',
      recommended: true,
      shareUrl: ({ url, text }) => {
        // Instagram doesn't support direct URL sharing, so we'll copy to clipboard
        return `https://www.instagram.com/`;
      }
    },
    {
      id: 'tiktok',
      name: 'TikTok',
      color: 'bg-black',
      icon: '🎵',
      aspectRatio: '9:16',
      recommended: true,
      shareUrl: ({ url, text }) => {
        // TikTok doesn't support direct URL sharing, so we'll copy to clipboard
        return `https://www.tiktok.com/`;
      }
    },
    {
      id: 'twitter',
      name: 'Twitter/X',
      color: 'bg-blue-500',
      icon: '🐦',
      aspectRatio: '16:9 or 1:1',
      shareUrl: ({ url, text, hashtags = "" }) => {
        const params = new URLSearchParams({
          text: `${text} ${hashtags}`,
          url: url
        });
        return `https://twitter.com/intent/tweet?${params.toString()}`;
      }
    },
    {
      id: 'facebook',
      name: 'Facebook',
      color: 'bg-blue-600',
      icon: '👥',
      shareUrl: ({ url, text }) => {
        const params = new URLSearchParams({
          u: url,
          quote: text
        });
        return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
      }
    },
    {
      id: 'linkedin',
      name: 'LinkedIn',
      color: 'bg-blue-700',
      icon: '💼',
      shareUrl: ({ url, text }) => {
        const params = new URLSearchParams({
          url: url,
          title: text
        });
        return `https://www.linkedin.com/sharing/share-offsite/?${params.toString()}`;
      }
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      color: 'bg-green-500',
      icon: '💬',
      shareUrl: ({ url, text }) => {
        const params = new URLSearchParams({
          text: `${text} ${url}`
        });
        return `https://wa.me/?${params.toString()}`;
      }
    }
  ];

  const handleShare = async (platform: SocialPlatform) => {
    const shareData = {
      url: videoUrl || window.location.href,
      text: `${title} - ${description}`,
      hashtags: "#KlutchMoments #Sports #Highlights #GetNoticed"
    };

    if (platform.id === 'instagram' || platform.id === 'tiktok') {
      // For Instagram and TikTok, copy to clipboard and provide instructions
      try {
        await navigator.clipboard.writeText(`${shareData.text}\n\n${shareData.url}\n\n${shareData.hashtags}`);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
        
        toast({
          title: `Ready to share on ${platform.name}!`,
          description: `Text copied to clipboard. Open ${platform.name} and paste to share your highlight.`,
        });
      } catch (err) {
        toast({
          title: "Copy failed",
          description: "Please manually copy the link to share.",
          variant: "destructive"
        });
      }
    } else {
      // For other platforms, open share URL
      const shareUrl = platform.shareUrl(shareData);
      window.open(shareUrl, '_blank', 'width=600,height=400');
      
      toast({
        title: `Sharing on ${platform.name}`,
        description: "Share window opened. Complete your post there!",
      });
    }
  };

  const copyToClipboard = async () => {
    try {
      const textToCopy = `${title}\n\n${description}\n\n${videoUrl}\n\n#KlutchMoments #Sports #Highlights #GetNoticed`;
      await navigator.clipboard.writeText(textToCopy);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
      
      toast({
        title: "Copied to clipboard!",
        description: "Your highlight details are ready to paste anywhere.",
      });
    } catch (err) {
      toast({
        title: "Copy failed",
        description: "Please manually copy the link.",
        variant: "destructive"
      });
    }
  };

  return (
    <Card className="p-4 sm:p-6">
      <div className="text-center mb-6">
        <h3 className="text-xl sm:text-2xl font-display font-bold mb-2 flex items-center justify-center gap-2">
          <Share className="w-5 h-5" />
          Share Your Highlight
        </h3>
        <p className="text-muted-foreground text-sm sm:text-base">
          Get noticed by sharing your highlight across social media platforms
        </p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <Button 
          onClick={onDownload}
          className="flex-1"
          variant="outline"
          data-testid="button-download-video"
        >
          <Download className="w-4 h-4 mr-2" />
          Download Video
        </Button>
        
        <Button 
          onClick={copyToClipboard}
          className="flex-1"
          variant="outline"
          data-testid="button-copy-details"
        >
          <Copy className="w-4 h-4 mr-2" />
          {isCopied ? 'Copied!' : 'Copy Details'}
        </Button>
      </div>

      {/* Social Platforms Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {socialPlatforms.map((platform) => (
          <Card 
            key={platform.id}
            className="relative p-4 hover-elevate cursor-pointer transition-all duration-200"
            onClick={() => handleShare(platform)}
            data-testid={`share-${platform.id}`}
          >
            {platform.recommended && (
              <Badge className="absolute -top-2 -right-2 bg-primary text-primary-foreground text-xs">
                Popular
              </Badge>
            )}
            
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${platform.color} flex items-center justify-center text-white`}>
                <span className="text-lg">{platform.icon}</span>
              </div>
              
              <div className="flex-1 min-w-0">
                <h4 className="font-medium text-sm">{platform.name}</h4>
                {platform.aspectRatio && (
                  <p className="text-xs text-muted-foreground">
                    Best: {platform.aspectRatio}
                  </p>
                )}
              </div>
              
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </div>
          </Card>
        ))}
      </div>

      {/* Tips */}
      <div className="mt-6 p-4 bg-muted/30 rounded-lg">
        <h4 className="font-medium text-sm mb-2">💡 Sharing Tips:</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• Post during peak hours (6-9 PM) for maximum engagement</li>
          <li>• Use relevant hashtags like #Sports #Recruiting #Highlights</li>
          <li>• Tag your team, coach, or school for wider reach</li>
          <li>• Include game details and your position/jersey number</li>
        </ul>
      </div>
    </Card>
  );
}