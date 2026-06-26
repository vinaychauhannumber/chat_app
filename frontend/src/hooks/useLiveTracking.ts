import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { LiveLocation, TrackingSession } from "../types";

export function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the earth in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return parseFloat(d.toFixed(2));
}

export function estimateETA(distanceKm: number): number {
  // Assume average speed in city carpooling is 40 km/h (1.5 minutes per km)
  return Math.ceil(distanceKm * 1.5);
}

export const useLiveTracking = (rideId: string, role: "driver" | "passenger") => {
  const { user } = useAuth();
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [passengerLocation, setPassengerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [session, setSession] = useState<TrackingSession | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const fetchSession = async () => {
    if (!rideId) return;
    try {
      const { data, error } = await supabase
        .from("ride_tracking_sessions")
        .select("*")
        .eq("ride_id", rideId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // If no tracking session exists, initialize one
          const { data: newSession, error: createError } = await supabase
            .from("ride_tracking_sessions")
            .insert({
              ride_id: rideId,
              status: "inactive",
              driver_shared: false,
              passenger_shared: false,
              driver_arrived: false,
              passenger_picked_up: false,
            })
            .select()
            .single();

          if (createError) throw createError;
          setSession(newSession);
        } else {
          throw error;
        }
      } else {
        setSession(data);
        if (data.driver_location_lat && data.driver_location_lng) {
          setDriverLocation({ lat: data.driver_location_lat, lng: data.driver_location_lng });
        }
        if (data.passenger_location_lat && data.passenger_location_lng) {
          setPassengerLocation({ lat: data.passenger_location_lat, lng: data.passenger_location_lng });
        }
      }
    } catch (err) {
      console.error("Error fetching tracking session:", err);
    }
  };

  const updateLocationInDb = async (lat: number, lng: number) => {
    if (!user || !rideId) return;
    try {
      // Upsert into live_locations
      const { error: locationError } = await supabase
        .from("live_locations")
        .upsert(
          {
            ride_id: rideId,
            user_id: user.id,
            latitude: lat,
            longitude: lng,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "ride_id,user_id" }
        );

      if (locationError) throw locationError;

      // Also update coordinates in ride_tracking_sessions
      const updateData: Partial<TrackingSession> = {};
      if (role === "driver") {
        updateData.driver_location_lat = lat;
        updateData.driver_location_lng = lng;
        updateData.driver_shared = true;
      } else {
        updateData.passenger_location_lat = lat;
        updateData.passenger_location_lng = lng;
        updateData.passenger_shared = true;
      }

      await supabase
        .from("ride_tracking_sessions")
        .update(updateData)
        .eq("ride_id", rideId);
    } catch (err) {
      console.error("Error updating location in db:", err);
    }
  };

  const startSharingLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    setIsSharing(true);

    const handleSuccess = (position: GeolocationPosition) => {
      const { latitude, longitude } = position.coords;
      if (role === "driver") {
        setDriverLocation({ lat: latitude, lng: longitude });
      } else {
        setPassengerLocation({ lat: latitude, lng: longitude });
      }
      updateLocationInDb(latitude, longitude);
    };

    const handleError = (error: GeolocationPositionError) => {
      console.error("Error watching geolocation:", error);
      setIsSharing(false);
    };

    // Watch position
    watchIdRef.current = navigator.geolocation.watchPosition(handleSuccess, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 5000,
    });
  };

  const stopSharingLocation = async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsSharing(false);
    
    // Set share status as false in DB
    try {
      const updateData: Record<string, boolean> = {};
      if (role === "driver") {
        updateData.driver_shared = false;
      } else {
        updateData.passenger_shared = false;
      }
      await supabase
        .from("ride_tracking_sessions")
        .update(updateData)
        .eq("ride_id", rideId);
    } catch (e) {
      console.error("Error updates tracking share status:", e);
    }
  };

  const updateSessionStatus = async (status: TrackingSession["status"]) => {
    if (!rideId) return;
    try {
      const { error } = await supabase
        .from("ride_tracking_sessions")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("ride_id", rideId);

      if (error) throw error;
      
      // Also update ride table status if changing to active or completed
      if (status === "active") {
        await supabase.from("rides").update({ status: "active" }).eq("id", rideId);
      } else if (status === "completed") {
        await supabase.from("rides").update({ status: "completed" }).eq("id", rideId);
        // Mark bookings for this ride as completed too
        await supabase.from("ride_bookings").update({ status: "completed" }).eq("ride_id", rideId).eq("status", "active");
      }
    } catch (err) {
      console.error("Error updating session status:", err);
    }
  };

  const setDriverArrived = async () => {
    try {
      const { error } = await supabase
        .from("ride_tracking_sessions")
        .update({ driver_arrived: true, status: "pickup" })
        .eq("ride_id", rideId);
      if (error) throw error;
    } catch (err) {
      console.error("Error setting driver arrived:", err);
    }
  };

  const confirmPickup = async () => {
    try {
      const { error } = await supabase
        .from("ride_tracking_sessions")
        .update({ passenger_picked_up: true })
        .eq("ride_id", rideId);
      if (error) throw error;
    } catch (err) {
      console.error("Error setting passenger picked up:", err);
    }
  };

  useEffect(() => {
    if (!rideId) return;

    fetchSession();

    // Subscribe to session changes
    const subscription = supabase
      .channel(`public:ride_tracking_sessions:ride_id=eq.${rideId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "ride_tracking_sessions",
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          const updated = payload.new as TrackingSession;
          setSession(updated);
          
          if (updated.driver_location_lat && updated.driver_location_lng) {
            setDriverLocation({ lat: updated.driver_location_lat, lng: updated.driver_location_lng });
          }
          if (updated.passenger_location_lat && updated.passenger_location_lng) {
            setPassengerLocation({ lat: updated.passenger_location_lat, lng: updated.passenger_location_lng });
          }
        }
      )
      .subscribe();

    return () => {
      stopSharingLocation();
      supabase.removeChannel(subscription);
    };
  }, [rideId]);

  // Calculate distance & ETA
  const distance =
    driverLocation && passengerLocation
      ? getDistance(driverLocation.lat, driverLocation.lng, passengerLocation.lat, passengerLocation.lng)
      : null;

  const eta = distance !== null ? estimateETA(distance) : null;

  return {
    driverLocation,
    passengerLocation,
    session,
    isSharing,
    distance,
    eta,
    startSharingLocation,
    stopSharingLocation,
    updateSessionStatus,
    setDriverArrived,
    confirmPickup,
  };
};
