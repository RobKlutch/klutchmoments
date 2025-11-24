import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  Play, 
  Search, 
  Filter, 
  Star, 
  Clock, 
  Zap,
  Crown,
  Users,
  Target,
  Trophy
} from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string;
  sport: string;
  style: string;
  aspectRatio: string;
  duration: number;
  creditCost: number;
  isPopular: boolean;
  isPremium: boolean;
  thumbnailUrl?: string;
  previewVideoUrl?: string;
  tags: string[];
}

interface TemplateSelectorProps {
  selectedSport?: string;
  onTemplateSelect: (template: Template) => void;
  onSkip?: () => void;
}

export default function TemplateSelector({ 
  selectedSport, 
  onTemplateSelect, 
  onSkip 
}: TemplateSelectorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSportFilter, setSelectedSportFilter] = useState(selectedSport || "all");
  const [selectedStyle, setSelectedStyle] = useState("all");
  const [showPreview, setShowPreview] = useState<string | null>(null);

  // Mock templates - in real app, these would come from API
  const templates: Template[] = [
    {
      id: "1",
      name: "Quick Highlight",
      description: "Perfect for single amazing plays - spotlight effect with slow motion",
      sport: "football",
      style: "highlight",
      aspectRatio: "16:9",
      duration: 15,
      creditCost: 1,
      isPopular: true,
      isPremium: false,
      tags: ["single-play", "spotlight", "social-ready"]
    },
    {
      id: "2", 
      name: "Recruiting Tape Pro",
      description: "Professional recruiting highlight with stats overlay and multiple angles",
      sport: "football",
      style: "recruiting",
      aspectRatio: "16:9", 
      duration: 60,
      creditCost: 3,
      isPopular: true,
      isPremium: true,
      tags: ["recruiting", "professional", "stats", "multi-angle"]
    },
    {
      id: "3",
      name: "Instagram Reel",
      description: "Vertical format perfect for Instagram and TikTok with trendy effects",
      sport: "basketball",
      style: "social",
      aspectRatio: "9:16",
      duration: 30,
      creditCost: 2,
      isPopular: true,
      isPremium: false,
      tags: ["vertical", "instagram", "tiktok", "trendy"]
    },
    {
      id: "4",
      name: "Season Highlight Reel",
      description: "Compile multiple clips into an epic season recap with music",
      sport: "soccer",
      style: "full-reel",
      aspectRatio: "16:9",
      duration: 120,
      creditCost: 5,
      isPopular: false,
      isPremium: true,
      tags: ["season", "compilation", "music", "epic"]
    },
    {
      id: "5",
      name: "Basketball Skills Showcase",
      description: "Show off your handles and shots with dynamic camera effects",
      sport: "basketball",
      style: "highlight",
      aspectRatio: "1:1",
      duration: 20,
      creditCost: 2,
      isPopular: false,
      isPremium: false,
      tags: ["skills", "dynamic", "square"]
    },
    {
      id: "6",
      name: "Soccer Goal Compilation",
      description: "Multiple goals with celebration moments and crowd reactions",
      sport: "soccer",
      style: "highlight",
      aspectRatio: "16:9",
      duration: 45,
      creditCost: 3,
      isPopular: false,
      isPremium: false,
      tags: ["goals", "celebration", "multiple-clips"]
    }
  ];

  const sports = ["all", "football", "basketball", "soccer", "baseball", "volleyball"];
  const styles = ["all", "highlight", "recruiting", "social", "full-reel"];

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesSport = selectedSportFilter === "all" || template.sport === selectedSportFilter;
    const matchesStyle = selectedStyle === "all" || template.style === selectedStyle;
    
    return matchesSearch && matchesSport && matchesStyle;
  });

  const popularTemplates = filteredTemplates.filter(t => t.isPopular);
  const otherTemplates = filteredTemplates.filter(t => !t.isPopular);

  const getSportIcon = (sport: string) => {
    switch (sport) {
      case "football": return "🏈";
      case "basketball": return "🏀";
      case "soccer": return "⚽";
      case "baseball": return "⚾";
      case "volleyball": return "🏐";
      default: return "🏆";
    }
  };

  const getStyleIcon = (style: string) => {
    switch (style) {
      case "highlight": return <Zap className="w-4 h-4" />;
      case "recruiting": return <Target className="w-4 h-4" />;
      case "social": return <Users className="w-4 h-4" />;
      case "full-reel": return <Trophy className="w-4 h-4" />;
      default: return <Star className="w-4 h-4" />;
    }
  };

  const handleTemplateSelect = (template: Template) => {
    onTemplateSelect(template);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2">
          Choose Your Template
        </h2>
        <p className="text-muted-foreground text-sm sm:text-base">
          Pick a professional template designed for your sport and style
        </p>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
            data-testid="input-template-search"
          />
        </div>
        
        <div className="flex gap-2">
          <Select value={selectedSportFilter} onValueChange={setSelectedSportFilter}>
            <SelectTrigger className="w-32" data-testid="select-sport-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sports.map(sport => (
                <SelectItem key={sport} value={sport}>
                  {sport === "all" ? "All Sports" : sport.charAt(0).toUpperCase() + sport.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedStyle} onValueChange={setSelectedStyle}>
            <SelectTrigger className="w-32" data-testid="select-style-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {styles.map(style => (
                <SelectItem key={style} value={style}>
                  {style === "all" ? "All Styles" : style.replace("-", " ").replace(/\b\w/g, l => l.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Popular Templates */}
      {popularTemplates.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-500" />
            Popular Templates
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {popularTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={handleTemplateSelect}
                getSportIcon={getSportIcon}
                getStyleIcon={getStyleIcon}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other Templates */}
      {otherTemplates.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">
            All Templates
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {otherTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onSelect={handleTemplateSelect}
                getSportIcon={getSportIcon}
                getStyleIcon={getStyleIcon}
              />
            ))}
          </div>
        </div>
      )}

      {/* No Results */}
      {filteredTemplates.length === 0 && (
        <div className="text-center py-12">
          <Filter className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium mb-2">No templates found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters</p>
        </div>
      )}

      {/* Skip Option */}
      {onSkip && (
        <div className="text-center pt-6 border-t">
          <p className="text-sm text-muted-foreground mb-3">
            Want to use the basic spotlight effect instead?
          </p>
          <Button
            variant="ghost"
            onClick={onSkip}
            data-testid="button-skip-template"
          >
            Skip Template Selection
          </Button>
        </div>
      )}
    </div>
  );
}

interface TemplateCardProps {
  template: Template;
  onSelect: (template: Template) => void;
  getSportIcon: (sport: string) => string;
  getStyleIcon: (style: string) => JSX.Element;
}

function TemplateCard({ template, onSelect, getSportIcon, getStyleIcon }: TemplateCardProps) {
  return (
    <Card className="overflow-hidden hover-elevate transition-all duration-200 cursor-pointer group" data-testid={`template-card-${template.id}`}>
      {/* Template Preview */}
      <div className="relative aspect-video bg-gradient-to-br from-primary/10 to-primary/20 flex items-center justify-center">
        {template.thumbnailUrl ? (
          <img 
            src={template.thumbnailUrl} 
            alt={template.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-center">
            <div className="text-4xl mb-2">{getSportIcon(template.sport)}</div>
            <div className="text-xs text-muted-foreground">Template Preview</div>
          </div>
        )}
        
        {/* Preview Button */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
          <Button size="icon" variant="secondary" className="rounded-full">
            <Play className="w-4 h-4" />
          </Button>
        </div>

        {/* Badges */}
        <div className="absolute top-2 left-2 flex gap-1">
          {template.isPopular && (
            <Badge className="bg-yellow-500 text-yellow-50 text-xs">
              <Star className="w-3 h-3 mr-1" />
              Popular
            </Badge>
          )}
          {template.isPremium && (
            <Badge className="bg-purple-500 text-purple-50 text-xs">
              <Crown className="w-3 h-3 mr-1" />
              Premium
            </Badge>
          )}
        </div>

        {/* Aspect Ratio */}
        <div className="absolute top-2 right-2">
          <Badge variant="secondary" className="text-xs">
            {template.aspectRatio}
          </Badge>
        </div>
      </div>

      {/* Template Info */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <h4 className="font-medium text-sm sm:text-base line-clamp-1">{template.name}</h4>
          <div className="flex items-center gap-1 text-primary font-medium text-sm">
            <Zap className="w-3 h-3" />
            {template.creditCost}
          </div>
        </div>

        <p className="text-xs sm:text-sm text-muted-foreground mb-3 line-clamp-2">
          {template.description}
        </p>

        {/* Template Details */}
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
          <div className="flex items-center gap-1">
            {getStyleIcon(template.style)}
            <span className="capitalize">{template.style}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {template.duration}s
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mb-4">
          {template.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>

        {/* Select Button */}
        <Button 
          onClick={() => onSelect(template)}
          className="w-full"
          data-testid={`button-select-template-${template.id}`}
        >
          Select Template
        </Button>
      </div>
    </Card>
  );
}