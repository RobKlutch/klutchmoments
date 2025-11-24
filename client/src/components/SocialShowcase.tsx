import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heart, MessageCircle, Share, Play } from "lucide-react";

interface SocialPost {
  id: string;
  platform: 'instagram' | 'tiktok';
  username: string;
  avatar: string;
  videoThumbnail: string;
  caption: string;
  likes: number;
  comments: number;
  timestamp: string;
  sport: string;
}

export default function SocialShowcase() {
  // todo: remove mock functionality - replace with real API data from Instagram/TikTok
  const mockPosts: SocialPost[] = [
    {
      id: '1',
      platform: 'instagram',
      username: '@sarah_soccer_star',
      avatar: '',
      videoThumbnail: '',
      caption: 'Game winning goal! 🔥 Thanks @klutchmoments for the highlight!',
      likes: 324,
      comments: 28,
      timestamp: '2h ago',
      sport: 'Soccer'
    },
    {
      id: '2',
      platform: 'tiktok',
      username: '@basketball_mike',
      avatar: '',
      videoThumbnail: '',
      caption: 'Nothing but net! 🏀 #klutchmoments #highlight',
      likes: 1247,
      comments: 89,
      timestamp: '4h ago',
      sport: 'Basketball'
    },
    {
      id: '3',
      platform: 'instagram',
      username: '@volleyball_queen',
      avatar: '',
      videoThumbnail: '',
      caption: 'Perfect spike! 💪 Created with @klutchmoments',
      likes: 567,
      comments: 42,
      timestamp: '6h ago',
      sport: 'Volleyball'
    },
    {
      id: '4',
      platform: 'tiktok',
      username: '@tennis_ace_anna',
      avatar: '',
      videoThumbnail: '',
      caption: 'Match point winner! 🎾 #highlight #klutchmoments',
      likes: 892,
      comments: 63,
      timestamp: '8h ago',
      sport: 'Tennis'
    },
    {
      id: '5',
      platform: 'instagram',
      username: '@football_flash',
      avatar: '',
      videoThumbnail: '',
      caption: 'Touchdown celebration! 🏈 @klutchmoments made this epic',
      likes: 445,
      comments: 35,
      timestamp: '12h ago',
      sport: 'Football'
    },
    {
      id: '6',
      platform: 'tiktok',
      username: '@baseball_bobby',
      avatar: '',
      videoThumbnail: '',
      caption: 'Home run swing! ⚾ #highlight #sports #klutchmoments',
      likes: 723,
      comments: 51,
      timestamp: '1d ago',
      sport: 'Baseball'
    }
  ];

  const getPlatformColor = (platform: string) => {
    return platform === 'instagram' ? 'bg-gradient-to-r from-purple-500 to-pink-500' : 'bg-black';
  };

  const getPlatformIcon = (platform: string) => {
    return platform === 'instagram' ? '📷' : '🎵';
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
  };

  return (
    <section className="py-8 sm:py-12 lg:py-16 bg-muted/30">
      <div className="container px-4 mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
            Latest Klutch Moments in Action
          </h2>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl mx-auto">
            See how athletes are sharing their highlight reels and getting noticed on social media
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6 max-w-7xl mx-auto">
          {mockPosts.map((post) => (
            <Card key={post.id} className="overflow-hidden hover-elevate transition-all duration-300" data-testid={`social-card-${post.id}`}>
              {/* Platform Header */}
              <div className="p-3 sm:p-4 border-b">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                    <div className="w-6 h-6 sm:w-8 sm:h-8 bg-accent rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-xs sm:text-sm">👤</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-xs sm:text-sm truncate">{post.username}</p>
                      <p className="text-xs text-muted-foreground">{post.timestamp}</p>
                    </div>
                  </div>
                  <div className={`px-2 py-1 rounded-full ${getPlatformColor(post.platform)} text-white text-xs flex items-center gap-1 flex-shrink-0`}>
                    <span>{getPlatformIcon(post.platform)}</span>
                    <span className="hidden sm:inline">{post.platform}</span>
                  </div>
                </div>
              </div>

              {/* Video Thumbnail */}
              <div className="relative aspect-video bg-black/5">
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/10 to-primary/20">
                  <div className="w-16 h-16 bg-black/20 rounded-full flex items-center justify-center">
                    <Play className="w-8 h-8 text-white/80" />
                  </div>
                </div>
                
                {/* Sport Badge */}
                <Badge className="absolute top-3 left-3 bg-black/70 text-white">
                  {post.sport}
                </Badge>
                
                {/* Klutch Moments Watermark */}
                <div className="absolute bottom-3 right-3 text-white/80 text-xs font-medium bg-black/50 px-2 py-1 rounded">
                  Klutch Moments
                </div>
              </div>

              {/* Content */}
              <div className="p-3 sm:p-4">
                <p className="text-xs sm:text-sm mb-3 line-clamp-2">{post.caption}</p>
                
                {/* Engagement Stats */}
                <div className="flex items-center gap-3 sm:gap-4 text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Heart className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="text-xs sm:text-sm">{formatNumber(post.likes)}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <MessageCircle className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="text-xs sm:text-sm">{formatNumber(post.comments)}</span>
                  </div>
                  <div className="flex items-center gap-1 ml-auto">
                    <Share className="w-3 h-3 sm:w-4 sm:h-4" />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-8 sm:mt-12">
          <p className="text-muted-foreground mb-4 text-sm sm:text-base">
            Ready to create your own viral highlight?
          </p>
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