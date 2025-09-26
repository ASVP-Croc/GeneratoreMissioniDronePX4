const fs = require('fs').promises;
const Handlebars = require('handlebars');

// Template per script Python con parametri fissi
const pythonTemplate = `#!/usr/bin/env python3
import rospy
from clover import srv
from std_srvs.srv import Trigger
from sensor_msgs.msg import NavSatFix
import math
from dataclasses import dataclass
from typing import Optional

# Variabili globali per tracciare posizione e stato della missione
POSITION_TOLERANCE = 0.3
POSITION_TOLERANCE_GPS = 1
mission_completed = False
use_global_mode = False

# Variabili globali per tracciare lo stato della missione
mission_completed = False
initial_gps_position = None  # Memorizza la posizione GPS iniziale
initial_map_position = [0, 0, 0]  # Memorizza la posizione 'map' iniziale

# PARAMETRI MISSIONE FISSI
FLIGHT_ALTITUDE = 3.5
FLIGHT_SPEED = 2.0
HOVER_TIME = 2.0

# WAYPOINTS IN COORDINATE GEOGRAFICHE (latitudine, longitudine, altitudine)
# GENERATI AUTOMATICAMENTE DAL BACKEND
ABSOLUTE_WAYPOINTS = [
    {{#each absoluteWaypoints}}
    [{{this.lat}}, {{this.lng}}, {{this.alt}}]{{#unless @last}},{{/unless}}
    {{/each}}
]

# WAYPOINTS IN COORDINATE CARTESIANE (metri) - relativi al frame 'map'
# GENERATI AUTOMATICAMENTE DAL BACKEND
CARTESIAN_WAYPOINTS = [
    {{#each cartesianWaypoints}}
    [{{this.x}}, {{this.y}}, {{this.z}}]{{#unless @last}},{{/unless}}
    {{/each}}
]

@dataclass
class CloverServices:
    """Raccoglie i proxy ai servizi ROS di Clover."""
    navigate: Optional[rospy.ServiceProxy] = None
    get_telemetry: Optional[rospy.ServiceProxy] = None
    land: Optional[rospy.ServiceProxy] = None
    release: Optional[rospy.ServiceProxy] = None
    navigate_global: Optional[rospy.ServiceProxy] = None

def check_gps_fix(services):
    """Verifica ultra-semplice del GPS."""
    try:
        rospy.wait_for_message('/mavros/global_position/global', NavSatFix, timeout=5.0)
        return True
    except:
        return False

def wait_for_position_global(services, target_lat, target_lon, speed, hover_time):
    """Attende che il drone raggiunga la posizione GPS target con una certa tolleranza."""
    start_time = rospy.get_time()
    
    # Costanti per la conversione da metri a gradi (approssimativa)
    EARTH_RADIUS = 6378137.0  # Raggio terrestre in metri (WGS84)

    def calculate_distance(lat1, lon1, lat2, lon2):
        """Calcola la distanza in metri tra due coordinate GPS usando la formula di Haversine"""
        lat1_rad = math.radians(lat1)
        lon1_rad = math.radians(lon1)
        lat2_rad = math.radians(lat2)
        lon2_rad = math.radians(lon2)
        
        dlat = lat2_rad - lat1_rad
        dlon = lon2_rad - lon1_rad
        
        a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return EARTH_RADIUS * c

    telem = services.get_telemetry(frame_id='global')
    initial_distance = calculate_distance(telem.lat, telem.lon, target_lat, target_lon)
    time_required = initial_distance / speed + hover_time if speed > 0 else hover_time
    timeout = time_required
    
    rospy.loginfo(f"Distance to target: {initial_distance:.2f} m, timeout: {timeout:.2f} s")
    
    while rospy.get_time() - start_time < timeout:
        telem = services.get_telemetry(frame_id='global')
        current_distance = calculate_distance(telem.lat, telem.lon, target_lat, target_lon)
        
        if current_distance < POSITION_TOLERANCE_GPS:
            rospy.loginfo(f"Target reached. Horizontal error: {current_distance:.2f} m")
            return True
        
        rospy.sleep(0.5)
    
    return False

def wait_for_position_map(services, target_x, target_y, speed, hover_time):
    """Attende che il drone raggiunga la posizione target nel frame 'map' con timeout dinamico."""
    start_time = rospy.get_time()
    
    def calculate_horizontal_distance(x1, y1, x2, y2):
        """Calcola la distanza orizzontale (solo x,y)"""
        dx = x2 - x1
        dy = y2 - y1
        return math.sqrt(dx*dx + dy*dy)

    # Ottiene la posizione corrente
    telem = services.get_telemetry(frame_id='map')
    
    # Calcola la distanza orizzontale iniziale
    initial_horizontal_distance = calculate_horizontal_distance(telem.x, telem.y, target_x, target_y)
    
    # Calcola il timeout dinamico basato sulla distanza orizzontale e velocità
    if speed > 0:
        time_required = initial_horizontal_distance / speed + hover_time
    else:
        time_required = hover_time 
    
    timeout = time_required
    
    rospy.loginfo(f"Distance to target: {initial_horizontal_distance:.2f} m, timeout: {time_required:.2f} s ")
    
    while rospy.get_time() - start_time < timeout:
        telem = services.get_telemetry(frame_id='map')
        
        # Calcola gli errori attuali
        dx = abs(telem.x - target_x)
        dy = abs(telem.y - target_y)
        current_horizontal_distance = calculate_horizontal_distance(telem.x, telem.y, target_x, target_y)
        
        # Verifica se il target è stato raggiunto
        if current_horizontal_distance < POSITION_TOLERANCE:
            rospy.loginfo(f"Target reached. Horizontal error: {current_horizontal_distance:.2f} m")
            return True
        
        rospy.sleep(0.5)
    return False

def navigate_wait_global(services: CloverServices, target_lat, target_lon, target_alt, speed, hover_time):
    """Muove il drone verso coordinate GPS assolute e attende il raggiungimento."""
    try:
        services.navigate_global(lat=target_lat, lon=target_lon, z=target_alt, speed=speed)
        rospy.loginfo(f"[NAVIGATE_GLOBAL] Moving to GPS ({target_lat:.6f}, {target_lon:.6f}, {target_alt:.2f})")
        
        if not wait_for_position_global(services, target_lat, target_lon, speed, hover_time):
            rospy.logwarn("Failed to reach waypoint in time.")
        
        rospy.sleep(hover_time)
        return
    except Exception as e:
        rospy.logerr(f"Error during navigate_wait_global: {e}")
        raise

def navigate_wait_map(services: CloverServices, target_x, target_y, target_z, speed, hover_time):
    """Muove il drone verso coordinate assolute nel frame 'map' e attende il raggiungimento."""
    try:
        services.navigate(x=target_x, y=target_y, z=target_z, yaw=float('nan'), speed=speed, frame_id='map')
        rospy.loginfo(f"[NAVIGATE] Moving to ({target_x:.2f}, {target_y:.2f}, {target_z:.2f}) in map frame")
        
        if not wait_for_position_map(services, target_x, target_y, speed, hover_time):
            rospy.logwarn("Failed to reach waypoint in time.")
        
        rospy.sleep(hover_time)
        return
    except Exception as e:
        rospy.logerr(f"Error during navigate_wait_map: {e}")
        raise

def takeoff(services: CloverServices, altitude, speed):
    """Decollo a un'altitudine specifica."""
    rospy.loginfo(f"[TAKEOFF] Ascending to {altitude:.2f} m...")
    
    try:
        telem = services.get_telemetry(frame_id='body')
        
        # Usa navigate in 'body' frame per salire in verticale
        services.navigate(x=0, y=0, z=altitude, yaw=float('nan'), speed=speed, frame_id='body', auto_arm=True)

        # Attendi che l'altitudine sia raggiunta
        if use_global_mode:
            if not wait_for_position_global(services, telem.x, telem.y, speed, HOVER_TIME):
                rospy.logwarn("Failed to reach takeoff altitude.")
            else:
                rospy.loginfo("[TAKEOFF] Takeoff completed successfully")
        else:
            if not wait_for_position_map(services, telem.x, telem.y, speed, HOVER_TIME):
                rospy.logwarn("Failed to reach takeoff altitude.")
            else:
                rospy.loginfo("[TAKEOFF] Takeoff completed successfully")

    except Exception as e:
        rospy.logerr(f"Error during takeoff: {e}")
        safe_shutdown(services)
        raise

def safe_shutdown(services: CloverServices):
    """Atterraggio di emergenza in caso di problemi."""
    global mission_completed
    if not rospy.is_shutdown() and not mission_completed:
        try:
            rospy.logwarn("Emergency landing initiated...")
            services.land()
            rospy.sleep(5)
            rospy.loginfo("Safe landing complete.")
        except Exception as e:
            rospy.logerr(f"Error during emergency landing: {e}")

def main():
    global mission_completed, initial_gps_position, initial_map_position
    
    rospy.init_node('hybrid_navigation')
    rospy.loginfo("Initializing hybrid navigation node...")
    
    services = CloverServices()
    service_list = [
        ('navigate', srv.Navigate),
        ('get_telemetry', srv.GetTelemetry),
        ('land', Trigger),
        ('navigate_global', srv.NavigateGlobal),
        ('simple_offboard/release', Trigger)
    ]
    
    for name, srv_type in service_list:
        try:
            rospy.wait_for_service(name, timeout=10.0)
            service_name = name if name != 'simple_offboard/release' else 'release'
            setattr(services, service_name, rospy.ServiceProxy(name, srv_type))
            rospy.loginfo(f"Service '{name}' READY")
        except rospy.ROSException as e:
            rospy.logerr(f"Service '{name}' not available: {e}")
            return
    
    rospy.on_shutdown(lambda: safe_shutdown(services))
    
    use_global_mode = check_gps_fix(services)
    
    if use_global_mode:
        rospy.loginfo("GPS fix detected. Using global navigation mode.")
        waypoints = ABSOLUTE_WAYPOINTS
        try:
            telem = services.get_telemetry(frame_id='global')
            initial_gps_position = (telem.lat, telem.lon, telem.alt)
            rospy.loginfo(f"Initial GPS position: lat={telem.lat:.6f}, lon={telem.lon:.6f}, alt={telem.alt:.2f}")
        except Exception as e:
            rospy.logerr(f"Failed to get initial GPS telemetry: {e}")
            return
    else:
        rospy.loginfo("No GPS fix. Using local (map) navigation mode.")
        waypoints = CARTESIAN_WAYPOINTS
        try:
            telem = services.get_telemetry(frame_id='map')
            initial_map_position = (telem.x, telem.y, telem.z)
            rospy.loginfo(f"Initial MAP position: x={telem.x:.2f}, y={telem.y:.2f}, z={telem.z:.2f}")
        except Exception as e:
            rospy.logerr(f"Failed to get initial map telemetry: {e}")
            return

    try:
        if not waypoints:
            rospy.logerr("No waypoints provided for the selected navigation mode.")
            return

        takeoff(services, FLIGHT_ALTITUDE, FLIGHT_SPEED)
        
        for i, waypoint in enumerate(waypoints):
            if rospy.is_shutdown():
                break
            
            if use_global_mode:
                lat, lon, alt = waypoint
                rospy.loginfo(f"Navigating to waypoint {i+1}/{len(waypoints)}: GPS ({lat:.6f}, {lon:.6f}, {alt:.2f})")
                navigate_wait_global(services, lat, lon, FLIGHT_ALTITUDE, FLIGHT_SPEED, HOVER_TIME)
            else:
                x, y, z = waypoint
                rospy.loginfo(f"Navigating to waypoint {i+1}/{len(waypoints)}: MAP ({x:.2f}, {y:.2f}, {z:.2f})")
                navigate_wait_map(services, x, y, z, FLIGHT_SPEED, HOVER_TIME)
        
        # Ritorno alla posizione di lancio
        if not rospy.is_shutdown():
            rospy.loginfo("Returning to launch position...")
            if use_global_mode:
                navigate_wait_global(services, initial_gps_position[0], initial_gps_position[1], FLIGHT_ALTITUDE, FLIGHT_SPEED, HOVER_TIME)
            else:
                navigate_wait_map(services, initial_map_position[0], initial_map_position[1], FLIGHT_ALTITUDE, FLIGHT_SPEED, HOVER_TIME)
        
        # Atterraggio
        if not rospy.is_shutdown():
            rospy.loginfo("Landing...")
            services.land()
            rospy.sleep(5)
            
            services.release()
            mission_completed = True
            rospy.loginfo("Mission complete. OFFBOARD control released.")
            
    except Exception as e:
        rospy.logerr(f"Mission error: {e}")
    finally:
        if not mission_completed:
            safe_shutdown(services)

if __name__ == "__main__":
    try:
        main()
    except rospy.ROSInterruptException:
        rospy.logwarn("Interrupted by ROS")
    except Exception as e:
        rospy.logerr(f"Unexpected error: {e}")
`;

// Template per file .plan con parametri fissi
const planTemplate = `{
    "fileType": "Plan",
    "geoFence": {
        "circles": [],
        "polygons": [],
        "version": 2
    },
    "groundStation": "QGroundControl",
    "mission": {
        "cruiseSpeed": 15,
        "firmwareType": 12,
        "globalPlanAltitudeMode": 1,
        "hoverSpeed": 4,
        "items": [
            {
                "autoContinue": true,
                "command": 530,
                "doJumpId": 1,
                "frame": 2,
                "params": [0, 2, null, null, null, null, null],
                "type": "SimpleItem"
            },
            {
                "autoContinue": true,
                "command": 206,
                "doJumpId": 2,
                "frame": 2,
                "params": [0, 0, 0, 0, 0, 0, 0],
                "type": "SimpleItem"
            },
            {
                "autoContinue": true,
                "command": 2001,
                "doJumpId": 3,
                "frame": 2,
                "params": [0, null, null, null, null, null, null],
                "type": "SimpleItem"
            },
            {
                "autoContinue": true,
                "command": 178,
                "doJumpId": 4,
                "frame": 2,
                "params": [1, 4, -1, 0, 0, 0, 0],
                "type": "SimpleItem"
            },
            {
                "AMSLAltAboveTerrain": null,
                "Altitude": 3.5,
                "AltitudeMode": 1,
                "autoContinue": true,
                "command": 22,
                "doJumpId": 5,
                "frame": 3,
                "params": [0, 0, 0, null, {{homeLat}}, {{homeLng}}, 3.5],
                "type": "SimpleItem"
            },
            {{#each waypoints}}
            {
                "AMSLAltAboveTerrain": null,
                "Altitude": 3.5,
                "AltitudeMode": 1,
                "autoContinue": true,
                "command": 16,
                "doJumpId": {{add @index 6}},
                "frame": 3,
                "params": [2, 0, 0, null, {{this.lat}}, {{this.lng}}, 3.5],
                "type": "SimpleItem"
            }{{#unless @last}},{{/unless}}
            {{/each}},
            {
                "AMSLAltAboveTerrain": null,
                "Altitude": 3.5,
                "AltitudeMode": 1,
                "autoContinue": true,
                "command": 21,
                "doJumpId": {{add waypoints.length 7}},
                "frame": 3,
                "params": [0, 0, 0, null, {{homeLat}}, {{homeLng}}, 3.5],
                "type": "SimpleItem"
            },
            {
                "autoContinue": true,
                "command": 20,
                "doJumpId": {{add waypoints.length 8}},
                "frame": 2,
                "params": [0, 0, 0, 0, 0, 0, 0],
                "type": "SimpleItem"
            }
        ],
        "plannedHomePosition": [{{homeLat}}, {{homeLng}}, 0],
        "vehicleType": 2,
        "version": 2
    },
    "rallyPoints": {
        "points": [],
        "version": 2
    },
    "version": 1
}`;

// Registra helper per Handlebars per aggiungere numeri
Handlebars.registerHelper('add', function (a, b) {
    return a + b;
});

const generatePythonScript = async (data) => {
    const template = Handlebars.compile(pythonTemplate);
    return template(data);
};

const generatePlanFile = async (data) => {
    const template = Handlebars.compile(planTemplate);
    return template(data);
};

module.exports = { generatePythonScript, generatePlanFile };