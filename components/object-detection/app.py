import cv2
import json
import asyncio
import websockets
import threading
from ultralytics import YOLO
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from typing import List
import time
import os
from pydantic import BaseModel
from typing import Optional, Dict, Any

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Your Next.js app URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables
yolo = YOLO('yolov8s.pt')
video_capture = None
streaming = False
connected_websockets: List[WebSocket] = []
detection_thread = None

def getColours(cls_num):
    base_colors = [(255, 0, 0), (0, 255, 0), (0, 0, 255)]
    color_index = cls_num % len(base_colors)
    increments = [(1, -2, 1), (-2, 1, -1), (1, -1, 2)]
    color = [base_colors[color_index][i] + increments[color_index][i] * 
    (cls_num // len(base_colors)) % 256 for i in range(3)]
    return tuple(color)

async def broadcast_detection_data(data):
    """Broadcast detection data to all connected WebSocket clients"""
    if connected_websockets:
        disconnected = []
        for websocket in connected_websockets:
            try:
                await websocket.send_text(json.dumps(data))
            except:
                disconnected.append(websocket)
        
        # Remove disconnected websockets
        for ws in disconnected:
            connected_websockets.remove(ws)

def detection_loop():
    """Main detection loop that runs in a separate thread"""
    global video_capture, streaming
    
    while streaming and video_capture is not None:
        ret, frame = video_capture.read()
        if not ret:
            continue
            
        results = yolo.track(frame, stream=True)
        detected_objects = []
        
        for result in results:
            classes_names = result.names
            
            for box in result.boxes:
                if box.conf[0] > 0.4:
                    [x1, y1, x2, y2] = box.xyxy[0]
                    x1, y1, x2, y2 = int(x1), int(y1), int(x2), int(y2)
                    
                    cls = int(box.cls[0])
                    class_name = classes_names[cls]
                    confidence = float(box.conf[0])
                    
                    detected_objects.append({
                        "class_name": class_name,
                        "confidence": confidence,
                        "bbox": [x1, y1, x2, y2]
                    })
                    
                    # Draw on frame for local display
                    colour = getColours(cls)
                    cv2.rectangle(frame, (x1, y1), (x2, y2), colour, 2)
                    cv2.putText(frame, f'{class_name} {confidence:.2f}', 
                              (x1, y1), cv2.FONT_HERSHEY_SIMPLEX, 1, colour, 2)
        
        # Show frame locally
        cv2.imshow('YOLO Detection', frame)
        
        # Prepare data for frontend
        detection_data = {
            "objects": detected_objects,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "frame_width": frame.shape[1],
            "frame_height": frame.shape[0]
        }
        
        # Send data to frontend via WebSocket
        asyncio.run(broadcast_detection_data(detection_data))
        
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break
    
    # Cleanup
    if video_capture is not None:
        video_capture.release()
        cv2.destroyAllWindows()

def analyze_threat_with_groq(accumulated_objects):
    """Analyze accumulated objects using Groq API"""
    if not accumulated_objects:
        return {
            "threat_level": "low",
            "threat_percentage": 0,
            "risk_breakdown": {"high": 0, "medium": 0, "low": 100},
            "flagged_content": "No objects detected during the session.",
            "detected_keywords": [],
            "summary": "No threats detected in the video analysis session.",
            "recommendations": ["Continue regular monitoring", "No immediate action required"]
        }
    
    # Prepare object data for analysis
    object_list = []
    for obj in accumulated_objects:
        object_list.append(f"{obj['class_name']} (confidence: {obj['confidence']:.2f})")
    
    objects_text = ", ".join(object_list)
    
    # Create prompt for Groq
    prompt = f"""
    Analyze the following objects detected in a security video feed and provide a comprehensive threat assessment:

    Detected Objects: {objects_text}

    Please provide a detailed analysis in the following JSON format:
    {{
        "threat_level": "high/medium/low",
        "threat_percentage": <number 0-100>,
        "risk_breakdown": {{
            "high": <percentage>,
            "medium": <percentage>, 
            "low": <percentage>
        }},
        "flagged_content": "<explanation of concerning objects>",
        "detected_keywords": ["<list of concerning object names>"],
        "summary": "<overall assessment summary>",
        "recommendations": ["<list of recommended actions>"]
    }}

    Focus on security threats, weapons, dangerous objects, and potential risks. Be thorough in your analysis.
    """
    
    try:
        # Get Groq API key from environment
        groq_api_key = os.getenv("GROQ_API_KEY")
        if not groq_api_key:
            raise ValueError("GROQ_API_KEY environment variable not set")
        
        # Using requests directly instead of the Groq client to avoid compatibility issues
        import requests
        
        headers = {
            "Authorization": f"Bearer {groq_api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "messages": [
                {"role": "system", "content": "You are a security threat analysis expert. Analyze detected objects and provide comprehensive threat assessments."},
                {"role": "user", "content": prompt}
            ],
            "model": "mixtral-8x7b-32768",
            "temperature": 0.1,
            "max_tokens": 1000
        }
        
        response = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=payload
        )
        
        if response.status_code == 200:
            response_data = response.json()
            analysis_text = response_data["choices"][0]["message"]["content"]
            
            # Extract JSON from the response
            import re
            json_match = re.search(r'\{.*\}', analysis_text, re.DOTALL)
            if json_match:
                analysis_json = json.loads(json_match.group())
                return analysis_json
            else:
                raise ValueError("No valid JSON found in response")
        else:
            raise ValueError(f"API request failed with status code {response.status_code}: {response.text}")
            
    except Exception as e:
        print(f"Error with Groq analysis: {e}")

        detected_keywords = [
            obj["class_name"] for obj in accumulated_objects if "weapon" in obj["class_name"].lower() or 
                                                              "knife" in obj["class_name"].lower() or 
                                                              "gun" in obj["class_name"].lower() or
                                                              "scissors" in obj["class_name"].lower()
        ]

        if detected_keywords:
            threat_level = "high"
            threat_percentage = min(100, len(detected_keywords) * 20)  # simple heuristic
            risk_breakdown = {"high": threat_percentage, "medium": 100 - threat_percentage, "low": 0}
            flagged_content = f"Dangerous objects detected: {', '.join(detected_keywords)}."
            summary = f"High-risk situation detected with {len(detected_keywords)} dangerous objects."
            recommendations = [
    "Issue immediate alert: sharp weapon detected",
    "Alert local law enforcement for potential threat",
    "Discourage any approach — object could be concealed or used rapidly"
]
        else:
            threat_level = "low"
            threat_percentage = 0
            risk_breakdown = {"high": 0, "medium": 0, "low": 100}
            flagged_content = "No dangerous objects detected."
            summary = "Low-risk situation based on detected objects."
            recommendations = ["Continue monitoring", "No immediate action required"]

        return {
            "threat_level": threat_level,
            "threat_percentage": threat_percentage,
            "risk_breakdown": risk_breakdown,
            "flagged_content": flagged_content,
            "detected_keywords": detected_keywords,
            "summary": summary,
            "recommendations": recommendations
        }

@app.post("/start-stream")
async def start_stream():
    global video_capture, streaming, detection_thread
    
    # Make sure any existing video capture is properly closed
    if video_capture is not None:
        video_capture.release()
        video_capture = None
    
    # Initialize new video capture
    video_capture = cv2.VideoCapture(0)
    if not video_capture.isOpened():
        return {"error": "Could not open camera"}
    
    streaming = True
    
    # Start detection in a separate thread
    if detection_thread is not None and detection_thread.is_alive():
        # Wait for existing thread to finish
        streaming = False
        detection_thread.join(timeout=1.0)
    
    # Create new detection thread
    detection_thread = threading.Thread(target=detection_loop)
    detection_thread.daemon = True
    detection_thread.start()
    
    return {"message": "Streaming started"}

class StopStreamRequest(BaseModel):
    accumulated_objects: Optional[list] = []

@app.post("/stop-stream")
async def stop_stream(request: StopStreamRequest):
    global streaming, video_capture
    
    streaming = False
    
    # Analyze accumulated objects
    analysis = analyze_threat_with_groq(request.accumulated_objects)
    
    return {
        "message": "Streaming stopped",
        "analysis": analysis
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_websockets.append(websocket)
    
    try:
        while True:
            # Keep connection alive
            await websocket.receive_text()
    except WebSocketDisconnect:
        connected_websockets.remove(websocket)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
