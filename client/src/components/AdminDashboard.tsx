import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { 
  Users, 
  DollarSign, 
  FileVideo, 
  Activity,
  Search,
  Filter,
  Download,
  Edit,
  Trash2,
  Eye,
  Ban,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Calendar,
  UserCheck,
  UserX
} from "lucide-react";
import { Link } from "wouter";
import klutchLogo from "@assets/klutch (2)_1757644634520.png";

// Type definitions for API responses
interface AdminStats {
  totalUsers?: number;
  activeUsers?: number;
  monthlyRevenue?: number;
  totalRevenue?: number;
  totalHighlights?: number;
  todayHighlights?: number;
  avgCreditsPerUser?: number;
}

interface User {
  id: string;
  username: string;
  email: string;
  isActive: boolean;
  credits: number;
  createdAt: string;
  role?: string;
}

interface Order {
  id: string;
  userId: string;
  amount: number;
  credits: number;
  status: string;
  createdAt: string;
}

interface Highlight {
  id: string;
  userId: string;
  description?: string;
  effect: string;
  createdAt: string;
}

interface Setting {
  key: string;
  value: string;
  description: string;
}

// API Response types
interface UsersResponse {
  users: User[];
}

interface OrdersResponse {
  orders: Order[];
}

interface HighlightsResponse {
  highlights: Highlight[];
}

interface AdminManagementProps {
  userRole: string;
}

export default function AdminManagement({ userRole }: AdminManagementProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();

  const isAdmin = userRole === "admin" || userRole === "super_admin";
  const isSuperAdmin = userRole === "super_admin";

  // Fetch admin stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["/api/admin/stats"],
    enabled: isAdmin
  });

  // Fetch users for overview
  const { data: usersData } = useQuery<UsersResponse>({
    queryKey: ["/api/admin/users", { limit: 5 }],
    enabled: isAdmin
  });

  // Fetch orders for overview  
  const { data: ordersData } = useQuery<OrdersResponse>({
    queryKey: ["/api/admin/orders", { limit: 5 }],
    enabled: isAdmin
  });

  // Fetch highlights for overview
  const { data: highlightsData } = useQuery<HighlightsResponse>({
    queryKey: ["/api/admin/highlights", { limit: 5 }],
    enabled: isAdmin
  });

  const recentUsers: User[] = usersData?.users || [];
  const recentOrders: Order[] = ordersData?.orders || [];
  const recentHighlights: Highlight[] = highlightsData?.highlights || [];

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <Ban className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">You don't have permission to access the admin dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="rounded-md px-2 py-1 bg-white/90 dark:bg-white/90">
            <img 
              src={klutchLogo} 
              alt="Klutch logo" 
              className="h-5 md:h-6 w-auto" 
              data-testid="img-logo-admin"
            />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-display font-bold">Admin Dashboard</h1>
            <p className="text-muted-foreground">Manage users, orders, and platform settings</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" data-testid="button-creator-dashboard">
            <Link href="/admin/creator">
              <FileVideo className="w-4 h-4 mr-2" />
              Creator Tools
            </Link>
          </Button>
          <Badge variant={isSuperAdmin ? "default" : "secondary"} className="w-fit">
            {isSuperAdmin ? "Super Admin" : "Admin"}
          </Badge>
        </div>
      </div>

      {/* Overview Stats */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {statsLoading ? (
            Array.from({ length: 4 }, (_, i) => (
              <Card key={i} className="p-4 animate-pulse">
                <div className="h-16 bg-muted rounded" />
              </Card>
            ))
          ) : (stats as AdminStats) ? (
            <>
              <StatsCard
                title="Total Users"
                value={(stats as AdminStats).totalUsers?.toLocaleString() || "0"}
                subtitle={`${(stats as AdminStats).activeUsers || 0} active`}
                icon={<Users className="w-5 h-5" />}
                trend="+12.5%"
              />
              <StatsCard
                title="Monthly Revenue"
                value={`$${(stats as AdminStats).monthlyRevenue?.toLocaleString() || "0"}`}
                subtitle={`$${(stats as AdminStats).totalRevenue?.toLocaleString() || "0"} total`}
                icon={<DollarSign className="w-5 h-5" />}
                trend="+23.1%"
              />
              <StatsCard
                title="Highlights Created"
                value={(stats as AdminStats).totalHighlights?.toLocaleString() || "0"}
                subtitle={`${(stats as AdminStats).todayHighlights || 0} today`}
                icon={<FileVideo className="w-5 h-5" />}
                trend="+8.3%"
              />
              <StatsCard
                title="Avg Credits/User"
                value={(stats as AdminStats).avgCreditsPerUser?.toString() || "0"}
                subtitle="Last 30 days"
                icon={<Activity className="w-5 h-5" />}
                trend="+5.2%"
              />
            </>
          ) : null}
        </div>
      )}

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-5">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="users" data-testid="tab-users">Users</TabsTrigger>
          <TabsTrigger value="orders" data-testid="tab-orders">Orders</TabsTrigger>
          <TabsTrigger value="highlights" data-testid="tab-highlights">Highlights</TabsTrigger>
          {isSuperAdmin && <TabsTrigger value="settings" data-testid="tab-settings">Settings</TabsTrigger>}
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Users */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Recent Users</h3>
              <div className="space-y-3">
                {recentUsers.slice(0, 5).map((user: User) => (
                  <div key={user.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{user.username}</p>
                      <p className="text-xs text-muted-foreground">{user.email}</p>
                    </div>
                    <div className="text-right">
                      <Badge variant={user.isActive ? "default" : "destructive"} className="text-xs">
                        {user.isActive ? "Active" : "Suspended"}
                      </Badge>
                      <p className="text-xs text-muted-foreground mt-1">{user.credits} credits</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Recent Orders */}
            <Card className="p-6">
              <h3 className="text-lg font-semibold mb-4">Recent Orders</h3>
              <div className="space-y-3">
                {recentOrders.slice(0, 5).map((order: Order) => (
                  <div key={order.id} className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">Order #{order.id.slice(-6)}</p>
                      <p className="text-xs text-muted-foreground">${Number(order.amount).toFixed(2)} • {order.credits} credits</p>
                    </div>
                    <Badge variant={order.status === "completed" ? "default" : "outline"} className="text-xs">
                      {order.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users" className="space-y-4">
          <UserManagement searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        </TabsContent>

        {/* Orders Tab */}
        <TabsContent value="orders" className="space-y-4">
          <OrderManagement searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        </TabsContent>

        {/* Highlights Tab */}
        <TabsContent value="highlights" className="space-y-4">
          <HighlightManagement searchQuery={searchQuery} onSearchChange={setSearchQuery} />
        </TabsContent>

        {/* Settings Tab (Super Admin Only) */}
        {isSuperAdmin && (
          <TabsContent value="settings" className="space-y-4">
            <SystemSettings />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

interface StatsCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  trend: string;
}

function StatsCard({ title, value, subtitle, icon, trend }: StatsCardProps) {
  const isPositive = trend.startsWith("+");
  
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="p-2 bg-primary/10 rounded-lg">
          {icon}
        </div>
        <div className={`flex items-center text-xs ${isPositive ? "text-green-600" : "text-red-600"}`}>
          <TrendingUp className="w-3 h-3 mr-1" />
          {trend}
        </div>
      </div>
      <h3 className="text-2xl font-bold">{value}</h3>
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
    </Card>
  );
}

function UserManagement({ searchQuery, onSearchChange }: { searchQuery: string; onSearchChange: (query: string) => void }) {
  const { toast } = useToast();
  const [userFilter, setUserFilter] = useState("all");

  const { data: usersData, isLoading } = useQuery<UsersResponse>({
    queryKey: ["/api/admin/users", { search: searchQuery, limit: 50 }]
  });

  const suspendUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest(`/api/admin/users/${userId}/suspend`, "PATCH", { reason: "Administrative action" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User suspended successfully" });
    },
    onError: () => {
      toast({ title: "Failed to suspend user", variant: "destructive" });
    }
  });

  const activateUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return apiRequest(`/api/admin/users/${userId}/activate`, "PATCH", { reason: "Administrative action" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User activated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to activate user", variant: "destructive" });
    }
  });

  const users: User[] = usersData?.users || [];

  return (
    <Card className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h3 className="text-lg font-semibold">User Management</h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 w-64"
              data-testid="input-user-search"
            />
          </div>
          <Select value={userFilter} onValueChange={setUserFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="admin">Admins</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground border-b pb-2">
            <div className="col-span-3">User</div>
            <div className="col-span-2">Credits</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Joined</div>
            <div className="col-span-3">Actions</div>
          </div>
          
          {users.map((user: User) => (
            <div key={user.id} className="grid grid-cols-12 gap-4 text-sm py-3 border-b">
              <div className="col-span-3">
                <div>
                  <p className="font-medium">{user.email || user.username}</p>
                  <p className="text-muted-foreground">{user.username}</p>
                </div>
              </div>
              <div className="col-span-2">
                <Badge variant="outline">{user.credits} credits</Badge>
              </div>
              <div className="col-span-2">
                <Badge variant={user.isActive ? "default" : "destructive"}>
                  {user.isActive ? "Active" : "Suspended"}
                </Badge>
              </div>
              <div className="col-span-2">
                {new Date(user.createdAt).toLocaleDateString()}
              </div>
              <div className="col-span-3 flex gap-1">
                <Button size="sm" variant="ghost" data-testid={`button-view-user-${user.id}`}>
                  <Eye className="w-3 h-3" />
                </Button>
                {user.isActive ? (
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => suspendUserMutation.mutate(user.id)}
                    disabled={suspendUserMutation.isPending}
                    data-testid={`button-suspend-user-${user.id}`}
                  >
                    <UserX className="w-3 h-3" />
                  </Button>
                ) : (
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => activateUserMutation.mutate(user.id)}
                    disabled={activateUserMutation.isPending}
                    data-testid={`button-activate-user-${user.id}`}
                  >
                    <UserCheck className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function OrderManagement({ searchQuery, onSearchChange }: { searchQuery: string; onSearchChange: (query: string) => void }) {
  const { data: ordersData, isLoading } = useQuery<OrdersResponse>({
    queryKey: ["/api/admin/orders", { search: searchQuery, limit: 50 }]
  });

  const orders: Order[] = ordersData?.orders || [];

  return (
    <Card className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h3 className="text-lg font-semibold">Order Management</h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 w-64"
              data-testid="input-order-search"
            />
          </div>
          <Button variant="outline" size="sm" data-testid="button-export-orders">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground border-b pb-2">
            <div className="col-span-2">Order ID</div>
            <div className="col-span-3">Customer</div>
            <div className="col-span-2">Amount</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-2">Date</div>
            <div className="col-span-1">Actions</div>
          </div>

          {orders.map((order: Order) => (
            <div key={order.id} className="grid grid-cols-12 gap-4 text-sm py-3 border-b">
              <div className="col-span-2 font-mono">#{order.id.slice(-6)}</div>
              <div className="col-span-3">{order.userId}</div>
              <div className="col-span-2">${Number(order.amount).toFixed(2)}</div>
              <div className="col-span-2">
                <Badge variant={order.status === "completed" ? "default" : "outline"}>
                  {order.status}
                </Badge>
              </div>
              <div className="col-span-2">{new Date(order.createdAt).toLocaleDateString()}</div>
              <div className="col-span-1">
                <Button size="sm" variant="ghost" data-testid={`button-view-order-${order.id}`}>
                  <Eye className="w-3 h-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function HighlightManagement({ searchQuery, onSearchChange }: { searchQuery: string; onSearchChange: (query: string) => void }) {
  const { toast } = useToast();
  
  const { data: highlightsData, isLoading } = useQuery<HighlightsResponse>({
    queryKey: ["/api/admin/highlights", { search: searchQuery, limit: 50 }]
  });

  const deleteHighlightMutation = useMutation({
    mutationFn: async (highlightId: string) => {
      return apiRequest(`/api/admin/highlights/${highlightId}`, "DELETE", { reason: "Administrative action" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/highlights"] });
      toast({ title: "Highlight deleted successfully" });
    },
    onError: () => {
      toast({ title: "Failed to delete highlight", variant: "destructive" });
    }
  });

  const highlights: Highlight[] = highlightsData?.highlights || [];

  return (
    <Card className="p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h3 className="text-lg font-semibold">Highlight Management</h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search highlights..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 w-64"
              data-testid="input-highlight-search"
            />
          </div>
          <Select>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-16 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {highlights.map((highlight: Highlight) => (
            <div key={highlight.id} className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex items-center gap-4">
                <div className="w-16 h-10 bg-muted rounded flex items-center justify-center">
                  <FileVideo className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-medium">{highlight.description || `Highlight #${highlight.id.slice(-6)}`}</p>
                  <p className="text-sm text-muted-foreground">
                    User: {highlight.userId} • Effect: {highlight.effect}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Badge variant="default">Completed</Badge>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" data-testid={`button-view-highlight-${highlight.id}`}>
                    <Eye className="w-3 h-3" />
                  </Button>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={() => deleteHighlightMutation.mutate(highlight.id)}
                    disabled={deleteHighlightMutation.isPending}
                    data-testid={`button-delete-highlight-${highlight.id}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function SystemSettings() {
  const { data: settings, isLoading } = useQuery({
    queryKey: ["/api/admin/settings"]
  });

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-6">System Settings</h3>
      
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-12 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {/* System Settings */}
          <div>
            <h4 className="font-medium mb-3">Configuration</h4>
            <div className="space-y-3">
              {(settings as Setting[])?.map((setting: Setting) => (
                <div key={setting.key} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{setting.key.replace(/_/g, ' ').toUpperCase()}</p>
                    <p className="text-xs text-muted-foreground">{setting.description}</p>
                  </div>
                  <Badge variant={setting.value === "true" ? "default" : "outline"}>
                    {setting.value === "true" ? "Enabled" : setting.value === "false" ? "Disabled" : setting.value}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* System Status */}
          <div>
            <h4 className="font-medium mb-3">System Status</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm">Database: Healthy</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm">API: Operational</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-sm">Templates: Available</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}