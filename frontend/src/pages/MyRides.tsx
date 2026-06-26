import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Ride } from "../types";
import { useAuth } from "../context/AuthContext";
import { Card, CardContent } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import {
  Car, Calendar, Users, DollarSign, Search, Trash2, Edit, Copy, Eye,
  SlidersHorizontal, CheckCircle2, AlertCircle, Compass, Zap, HelpCircle, RefreshCw, X
} from "lucide-react";
import { formatDate, formatTime, formatPrice } from "../lib/utils";

// Arrival details calculation
const getArrivalDetails = (dateStr: string, timeStr: string, durationMin: number | null) => {
  if (!durationMin) {
    durationMin = 120; // 2 hour default
  }
  try {
    const [hours, minutes] = timeStr.split(":").map(Number);
    const date = new Date(`${dateStr}T${timeStr}`);
    let arrHours = 0;
    let arrMins = 0;

    if (isNaN(date.getTime())) {
      const depMinutes = hours * 60 + minutes;
      const arrMinutes = depMinutes + durationMin;
      arrHours = Math.floor(arrMinutes / 60) % 24;
      arrMins = arrMinutes % 60;
    } else {
      const arrDate = new Date(date.getTime() + durationMin * 60000);
      arrHours = arrDate.getHours();
      arrMins = arrDate.getMinutes();
    }

    const timeFormatted = `${String(arrHours).padStart(2, "0")}:${String(arrMins).padStart(2, "0")}`;
    const hrs = Math.floor(durationMin / 60);
    const mins = durationMin % 60;
    return {
      time: timeFormatted,
      durationText: hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
    };
  } catch (e) {
    return { time: "N/A", durationText: "N/A" };
  }
};

export const MyRides: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [rides, setRides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Statistics
  const [stats, setStats] = useState({
    published: 0,
    upcoming: 0,
    completed: 0,
    passengers: 0,
  });

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"upcoming" | "active" | "completed" | "cancelled">("upcoming");
  const [instantBookingFilter, setInstantBookingFilter] = useState(false);

  // Cancellation Modal States
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Fetch driver rides
  const fetchMyRides = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error: ridesError } = await supabase
        .from("rides")
        .select(`
          *,
          ride_bookings(
            id,
            seats_booked,
            status,
            passenger:profiles!ride_bookings_passenger_id_fkey(full_name, avatar_url)
          )
        `)
        .eq("driver_id", user.id)
        .order("departure_date", { ascending: true })
        .order("departure_time", { ascending: true });

      if (ridesError) throw ridesError;

      const rideList = data || [];
      setRides(rideList);

      // Aggregate Stats
      const published = rideList.length;
      const upcoming = rideList.filter((r) => r.status === "scheduled").length;
      const completed = rideList.filter((r) => r.status === "completed").length;

      // Sum seats of accepted/completed bookings
      let passengers = 0;
      rideList.forEach((r) => {
        const bookings = r.ride_bookings || [];
        bookings.forEach((b: any) => {
          if (b.status === "accepted" || b.status === "completed" || b.status === "active") {
            passengers += b.seats_booked;
          }
        });
      });

      setStats({ published, upcoming, completed, passengers });
    } catch (err: any) {
      console.error("Error fetching published rides:", err);
      setError(err.message || "Failed to load your rides");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMyRides();
  }, [user]);

  // Cancel ride handler
  const handleCancelRide = async () => {
    if (!selectedRideId) return;
    setCancelling(true);
    try {
      const { error: cancelError } = await supabase
        .from("rides")
        .update({ status: "cancelled" })
        .eq("id", selectedRideId);

      if (cancelError) throw cancelError;

      // Update bookings associated with the ride to cancelled
      await supabase
        .from("ride_bookings")
        .update({ status: "cancelled" })
        .eq("ride_id", selectedRideId)
        .eq("status", "pending");

      // Notify passenger bookings (optional, database triggers handles mostly)

      setCancelModalOpen(false);
      setSelectedRideId(null);
      await fetchMyRides();
    } catch (err: any) {
      console.error("Cancel ride error:", err);
      alert(err.message || "Failed to cancel ride");
    } finally {
      setCancelling(false);
    }
  };

  // Filter rides list
  const filteredRides = rides.filter((ride) => {
    // Tab filter
    const status = ride.status;
    if (activeTab === "upcoming" && status !== "scheduled") return false;
    if (activeTab === "active" && status !== "active") return false;
    if (activeTab === "completed" && status !== "completed") return false;
    if (activeTab === "cancelled" && status !== "cancelled") return false;

    // Search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const matchSource = ride.source.toLowerCase().includes(query);
      const matchDest = ride.destination.toLowerCase().includes(query);
      if (!matchSource && !matchDest) return false;
    }

    // Instant Booking checkbox
    if (instantBookingFilter && !ride.instant_booking) return false;

    return true;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Your Rides</h1>
        <p className="text-sm text-slate-500 mt-1">Manage and track all your published carpool rides</p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Published Rides", val: stats.published, desc: "Total created" },
          { label: "Upcoming Rides", val: stats.upcoming, desc: "Scheduled trips" },
          { label: "Completed Rides", val: stats.completed, desc: "Finished trips" },
          { label: "Total Passengers", val: stats.passengers, desc: "Accepted seats" }
        ].map((stat, idx) => (
          <Card key={idx} className="border border-slate-100 shadow-sm bg-white rounded-3xl p-5">
            <span className="text-xs text-slate-400 font-bold uppercase tracking-wider block">{stat.label}</span>
            <span className="text-3xl font-black text-slate-900 block mt-1.5">{stat.val}</span>
            <span className="text-[10px] text-slate-400 font-semibold block mt-1">{stat.desc}</span>
          </Card>
        ))}
      </div>

      {/* Controls row */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-2">
        {/* Tabs */}
        <div className="flex border border-slate-200 bg-slate-100/50 p-1.5 rounded-2xl gap-1 overflow-x-auto self-start">
          {[
            { id: "upcoming", label: "Upcoming" },
            { id: "active", label: "Active" },
            { id: "completed", label: "Completed" },
            { id: "cancelled", label: "Cancelled" }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition whitespace-nowrap ${
                activeTab === tab.id
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full md:w-auto">
          {/* Search bar */}
          <div className="relative flex-grow sm:w-60">
            <Input
              placeholder="Search by city..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 py-2 text-xs"
            />
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
          </div>

          {/* Instant checkbox */}
          <label className="flex items-center gap-2 px-3 py-2 border border-slate-200 bg-white rounded-xl text-xs text-slate-700 font-bold cursor-pointer hover:border-slate-300 transition shrink-0 select-none">
            <input
              type="checkbox"
              checked={instantBookingFilter}
              onChange={(e) => setInstantBookingFilter(e.target.checked)}
              className="h-4 w-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
            />
            <span>⚡ Instant Booking</span>
          </label>
        </div>
      </div>

      {/* Rides List */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="h-44 rounded-3xl bg-slate-100 animate-pulse border border-slate-200" />
          ))}
        </div>
      ) : filteredRides.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-16 text-center border-dashed border-2 border-slate-200 rounded-3xl bg-white">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 mb-6">
            <Car className="h-8 w-8 animate-pulse" />
          </div>
          <h3 className="text-xl font-bold text-slate-900">
            {searchQuery.trim() || instantBookingFilter
              ? "No matching rides found"
              : `You haven't published any ${activeTab} rides`}
          </h3>
          <p className="mt-2 text-sm text-slate-400 max-w-sm">
            {searchQuery.trim() || instantBookingFilter
              ? "Try modifying your search query or clear filters to see your rides list."
              : "Help other commuters save travel costs by sharing your empty car seats."}
          </p>
          <div className="mt-6">
            <Link to="/create-ride">
              <Button className="px-6 py-2.5 font-bold rounded-xl shadow-lg">Publish a Ride</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredRides.map((ride) => {
            const arr = getArrivalDetails(ride.departure_date, ride.departure_time, ride.estimated_duration);
            const totalBookings = ride.ride_bookings || [];
            
            // Sum of accepted passenger seats
            const acceptedSeats = totalBookings
              .filter((b: any) => b.status === "accepted" || b.status === "completed" || b.status === "active")
              .reduce((sum: number, b: any) => sum + b.seats_booked, 0);

            // Sum of pending seats
            const pendingCount = totalBookings.filter((b: any) => b.status === "pending").length;

            return (
              <Card key={ride.id} className="overflow-hidden border border-slate-100 hover:border-blue-100 hover:shadow-md transition duration-200 rounded-3xl bg-white">
                <CardContent className="p-6">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                    
                    {/* Route Details */}
                    <div className="flex-1 space-y-3.5">
                      <div className="flex items-center gap-2">
                        <Badge variant={ride.status === "scheduled" ? "info" : ride.status === "completed" ? "success" : "destructive"} className="capitalize">
                          {ride.status === "scheduled" ? "published" : ride.status}
                        </Badge>
                        {ride.instant_booking && (
                          <span className="inline-flex items-center gap-0.5 text-[9px] font-black text-amber-800 bg-amber-50 border border-amber-200/40 px-2 py-0.5 rounded-full uppercase tracking-wider">
                            <Zap className="h-3 w-3 fill-current" /> Instant Book
                          </span>
                        )}
                        {pendingCount > 0 && (
                          <span className="text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-0.5 rounded-full animate-pulse">
                            {pendingCount} Request{pendingCount !== 1 ? "s" : ""} Pending
                          </span>
                        )}
                      </div>

                      {/* Visual Timeline */}
                      <div className="flex items-center justify-between gap-4 max-w-lg">
                        <div className="text-left shrink-0">
                          <span className="text-lg font-black text-slate-900 block">{formatTime(ride.departure_time)}</span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5 truncate">{ride.source.split(",")[0]}</span>
                        </div>

                        <div className="flex-grow flex flex-col items-center">
                          <span className="text-[10px] text-slate-400 font-mono font-bold">{arr.durationText}</span>
                          <div className="w-full flex items-center gap-1.5 my-1">
                            <div className="h-2 w-2 rounded-full border-2 border-emerald-500 bg-white"></div>
                            <div className="flex-grow h-[1px] border-t border-dashed border-slate-300"></div>
                            <div className="h-2 w-2 rounded-full border-2 border-blue-500 bg-white"></div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-lg font-black text-slate-900 block">{arr.time}</span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mt-0.5 truncate">{ride.destination.split(",")[0]}</span>
                        </div>
                      </div>
                    </div>

                    {/* Stats & Pricing */}
                    <div className="flex flex-wrap lg:flex-col lg:items-end justify-between items-center gap-4 pt-4 lg:pt-0 border-t lg:border-t-0 border-slate-50 text-right">
                      <div className="flex gap-4 items-center">
                        <div className="text-left lg:text-right">
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">Vehicle</span>
                          <span className="text-xs font-bold text-slate-700 block mt-0.5 capitalize">{ride.vehicle_type}</span>
                        </div>
                        <div className="text-left lg:text-right">
                          <span className="text-[10px] text-slate-400 font-bold uppercase block">Seats Reserved</span>
                          <span className="text-xs font-bold text-slate-700 block mt-0.5">{acceptedSeats} / {ride.total_seats} booked</span>
                        </div>
                      </div>

                      <div className="flex gap-4 items-center lg:mt-2">
                        <div>
                          <span className="text-2xl font-black text-blue-600 block">₹{Math.round(ride.price_per_seat)}</span>
                          <span className="text-[9px] font-bold text-slate-400 block uppercase">per seat</span>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* Driver Card Actions */}
                  <div className="flex flex-wrap items-center justify-between gap-4 mt-6 pt-4 border-t border-slate-100">
                    <div className="flex items-center text-[10px] font-bold text-slate-400 uppercase tracking-wider flex-wrap gap-2.5">
                      <span>Date: <strong className="text-slate-600">{formatDate(ride.departure_date)}</strong></span>
                      <span>&bull;</span>
                      <span>Passengers Booked: <strong className="text-slate-600">{acceptedSeats}</strong></span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      <Link to={`/my-rides/${ride.id}`} className="flex-1 sm:flex-none">
                        <Button size="sm" variant="outline" className="w-full flex items-center justify-center gap-1 text-xs">
                          <Eye className="h-3.5 w-3.5 text-blue-500" />
                          <span>View Details</span>
                        </Button>
                      </Link>

                      {ride.status === "scheduled" && (
                        <Link to={`/my-rides/${ride.id}?edit=true`} className="flex-grow sm:flex-none">
                          <Button size="sm" variant="outline" className="w-full flex items-center justify-center gap-1 text-xs border-amber-100 text-amber-600 hover:bg-amber-50">
                            <Edit className="h-3.5 w-3.5" />
                            <span>Edit Ride</span>
                          </Button>
                        </Link>
                      )}

                      <Link to={`/create-ride?clone_id=${ride.id}`} className="flex-1 sm:flex-none">
                        <Button size="sm" variant="outline" className="w-full flex items-center justify-center gap-1 text-xs border-emerald-100 text-emerald-700 hover:bg-emerald-50">
                          <Copy className="h-3.5 w-3.5" />
                          <span>Publish Similar</span>
                        </Button>
                      </Link>

                      {ride.status === "scheduled" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelectedRideId(ride.id);
                            setCancelModalOpen(true);
                          }}
                          className="flex-grow sm:flex-none border-red-100 text-red-500 hover:bg-red-50 text-xs flex items-center justify-center gap-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Cancel Ride</span>
                        </Button>
                      )}
                    </div>
                  </div>

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Cancellation Confirmation Modal */}
      {cancelModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white rounded-3xl p-6 shadow-2xl max-w-md w-full border border-slate-100 space-y-4 animate-scale-up">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-50 text-red-500">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900">Cancel this trip?</h3>
              <p className="text-xs text-slate-400 leading-relaxed mt-1">
                Are you sure you want to cancel this ride? All pending bookings will be declined and accepted passengers will be notified of the cancellation. This action cannot be undone.
              </p>
            </div>
            <div className="pt-2 flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setCancelModalOpen(false);
                  setSelectedRideId(null);
                }}
                className="flex-1 py-2 text-xs font-bold rounded-xl"
              >
                No, Keep Trip
              </Button>
              <Button
                onClick={handleCancelRide}
                loading={cancelling}
                className="flex-1 py-2 text-xs font-bold bg-red-500 hover:bg-red-600 rounded-xl"
              >
                Yes, Cancel Ride
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
