"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Video, Camera, AlertTriangle } from "lucide-react"

interface DetectedObject {
  class_name: string
  confidence: number
  bbox: [number, number, number, number]
}

interface DetectionData {
  objects: DetectedObject[]
  timestamp: string
  frame_width: number
  frame_height: number
}

export function VideoAnalysis() {
  const [isStreaming, setIsStreaming] = useState(false)
  const [detectedObjects, setDetectedObjects] = useState<DetectedObject[]>([])
  const [threatLevel, setThreatLevel] = useState(0)
  const [processingStatus, setProcessingStatus] = useState("Idle")
  const wsRef = useRef<WebSocket | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [accumulatedObjects, setAccumulatedObjects] = useState<DetectedObject[]>([])
  const [threatAnalysis, setThreatAnalysis] = useState<any>(null)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  // WebSocket connection for real-time detection data
  useEffect(() => {
    if (isStreaming) {
      // Connect to WebSocket for real-time detection data
      wsRef.current = new WebSocket("ws://localhost:8000/ws")

      wsRef.current.onopen = () => {
        console.log("WebSocket connected")
        setProcessingStatus("Connected")
      }

      wsRef.current.onmessage = (event) => {
        try {
          const data: DetectionData = JSON.parse(event.data)
          setDetectedObjects(data.objects)

          // Accumulate unique objects
          setAccumulatedObjects((prev) => {
            // Create a map of existing objects by class name
            const objectMap = new Map()

            // Add existing objects to the map (keeping highest confidence)
            prev.forEach((obj) => {
              const key = obj.class_name
              if (!objectMap.has(key) || objectMap.get(key).confidence < obj.confidence) {
                objectMap.set(key, obj)
              }
            })

            // Add new objects to the map (if they have higher confidence)
            data.objects.forEach((newObj) => {
              const key = newObj.class_name
              if (!objectMap.has(key) || objectMap.get(key).confidence < newObj.confidence) {
                objectMap.set(key, newObj)
              }
            })

            // Convert map back to array
            return Array.from(objectMap.values())
          })

          // Calculate threat level based on detected objects
          const weaponDetected = data.objects.some(
            (obj) =>
              obj.class_name.toLowerCase().includes("knife") ||
              obj.class_name.toLowerCase().includes("gun") ||
              obj.class_name.toLowerCase().includes("weapon"),
          )

          if (weaponDetected) {
            setThreatLevel(92)
          } else {
            setThreatLevel(Math.max(...data.objects.map((obj) => obj.confidence * 100), 0))
          }

          setProcessingStatus("Real-time")
        } catch (error) {
          console.error("Error parsing WebSocket data:", error)
        }
      }

      wsRef.current.onclose = () => {
        console.log("WebSocket disconnected")
        setProcessingStatus("Disconnected")
      }

      wsRef.current.onerror = (error) => {
        console.error("WebSocket error:", error)
        setProcessingStatus("Error")
      }
    } else {
      // Close WebSocket when streaming stops
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setDetectedObjects([])
      setThreatLevel(0)
      setProcessingStatus("Idle")
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [isStreaming])

  const handleStreamToggle = async () => {
    try {
      if (!isStreaming) {
        // Start streaming
        setAccumulatedObjects([])
        setThreatAnalysis(null)
        setShowAnalysis(false)

        const response = await fetch("http://localhost:8000/start-stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })

        if (response.ok) {
          setIsStreaming(true)
          setProcessingStatus("Starting...")
        } else {
          console.error("Failed to start streaming")
          setProcessingStatus("Error")
        }
      } else {
        // Stop streaming and analyze
        setIsAnalyzing(true)

        const response = await fetch("http://localhost:8000/stop-stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accumulated_objects: accumulatedObjects,
          }),
        })

        if (response.ok) {
          const result = await response.json()
          setThreatAnalysis(result.analysis)
          setShowAnalysis(true)
          setIsStreaming(false)
          setIsAnalyzing(false)
        } else {
          console.error("Failed to stop streaming")
          setIsAnalyzing(false)
        }
      }
    } catch (error) {
      console.error("Error toggling stream:", error)
      setProcessingStatus("Error")
      setIsAnalyzing(false)
    }
  }

  // Get object statistics
  const getObjectStats = () => {
    const stats = accumulatedObjects.reduce(
      (acc, obj) => {
        const name = obj.class_name.toLowerCase()
        if (!acc[name]) {
          acc[name] = { count: 0, maxConfidence: 0 }
        }
        acc[name].count++
        acc[name].maxConfidence = Math.max(acc[name].maxConfidence, obj.confidence * 100)
        return acc
      },
      {} as Record<string, { count: number; maxConfidence: number }>,
    )

    return stats
  }

  const objectStats = getObjectStats()
  const hasWeaponThreat = detectedObjects.some(
    (obj) =>
      obj.class_name.toLowerCase().includes("knife") ||
      obj.class_name.toLowerCase().includes("gun") ||
      obj.class_name.toLowerCase().includes("weapon"),
  )

  return (
    <Card className="overflow-hidden border-0 bg-white/5 backdrop-blur-lg">
      <CardHeader className="bg-white/5 pb-2">
        <CardTitle className="text-white flex items-center gap-2">
          <Video className="h-5 w-5 text-purple-500" />
          Video Analysis
        </CardTitle>
        <CardDescription className="text-slate-300">Detect objects and threats in live video stream</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <div className="mb-4">
          <Button
            className={`w-full ${isStreaming ? "bg-red-600 hover:bg-red-700" : "bg-purple-600 hover:bg-purple-700"}`}
            onClick={handleStreamToggle}
            disabled={processingStatus === "Starting..." || isAnalyzing}
          >
            <Camera className="mr-2 h-4 w-4" />
            {isAnalyzing ? "Analyzing..." : isStreaming ? "Stop Stream" : "Start Stream"}
          </Button>
        </div>

        <div className="mt-4 aspect-video w-full overflow-hidden rounded-lg bg-black/50 relative">
          <div className="absolute inset-0 flex items-center justify-center">
            {isStreaming ? (
              <div className="text-white/60">
                <Camera className="h-12 w-12 mx-auto mb-2" />
                <p className="text-sm">Live Stream Active</p>
                <p className="text-xs">Objects: {detectedObjects.length}</p>
              </div>
            ) : (
              <div className="text-white/40">
                <Video className="h-12 w-12 mx-auto mb-2" />
                <p className="text-sm">Click Start Stream to begin</p>
              </div>
            )}
          </div>

          {/* Render detection boxes based on real data */}
          {detectedObjects.map((obj, index) => (
            <div
              key={index}
              className={`absolute rounded-md border-2 ${
                obj.class_name.toLowerCase().includes("weapon") ||
                obj.class_name.toLowerCase().includes("knife") ||
                obj.class_name.toLowerCase().includes("gun")
                  ? "border-red-500 bg-red-500/20"
                  : "border-amber-500 bg-amber-500/20"
              }`}
              style={{
                left: `${(obj.bbox[0] / 640) * 100}%`,
                top: `${(obj.bbox[1] / 480) * 100}%`,
                width: `${((obj.bbox[2] - obj.bbox[0]) / 640) * 100}%`,
                height: `${((obj.bbox[3] - obj.bbox[1]) / 480) * 100}%`,
              }}
            >
              <div
                className={`absolute -top-6 left-0 rounded-t-md px-2 py-1 text-xs text-white ${
                  obj.class_name.toLowerCase().includes("weapon") ||
                  obj.class_name.toLowerCase().includes("knife") ||
                  obj.class_name.toLowerCase().includes("gun")
                    ? "bg-red-500"
                    : "bg-amber-500"
                }`}
              >
                {obj.class_name} ({(obj.confidence * 100).toFixed(0)}%)
              </div>
            </div>
          ))}

          {/* Threat alert overlay */}
          {hasWeaponThreat && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
              <div className="rounded-lg bg-black/60 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-red-500">
                  <AlertTriangle className="h-6 w-6" />
                  <span className="text-lg font-bold">Threat Detected</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="font-medium text-white">Threat Probability</h4>
              <span
                className={`text-sm ${
                  threatLevel > 80 ? "text-red-400" : threatLevel > 50 ? "text-amber-400" : "text-green-400"
                }`}
              >
                {threatLevel > 80 ? "Critical" : threatLevel > 50 ? "Medium" : "Low"} ({threatLevel.toFixed(0)}%)
              </span>
            </div>
            <Progress
              value={threatLevel}
              className={`h-2 ${threatLevel > 80 ? "bg-red-500" : threatLevel > 50 ? "bg-amber-500" : "bg-green-500"}`}
            />
          </div>

          <div className="rounded-lg bg-white/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="font-medium text-white">Processing Status</h4>
              <span
                className={`text-sm ${
                  processingStatus === "Real-time"
                    ? "text-green-400"
                    : processingStatus === "Error"
                      ? "text-red-400"
                      : "text-amber-400"
                }`}
              >
                {processingStatus}
              </span>
            </div>
            <Progress
              value={processingStatus === "Real-time" ? 100 : processingStatus === "Error" ? 0 : 50}
              className={`h-2 ${
                processingStatus === "Real-time"
                  ? "bg-green-500"
                  : processingStatus === "Error"
                    ? "bg-red-500"
                    : "bg-amber-500"
              }`}
            />
          </div>

          {/* <div className="rounded-lg bg-white/5 p-4 md:col-span-2">
            <h4 className="mb-3 font-medium text-white">Detected Objects</h4>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(objectStats)
                .slice(0, 4)
                .map(([name, stats]) => (
                  <div
                    key={name}
                    className={`rounded-md p-3 text-center ${
                      name.includes("weapon") || name.includes("knife") || name.includes("gun")
                        ? "bg-red-500/10"
                        : "bg-white/5"
                    }`}
                  >
                    <div
                      className={`text-xs ${
                        name.includes("weapon") || name.includes("knife") || name.includes("gun")
                          ? "text-red-300"
                          : "text-slate-300"
                      }`}
                    >
                      {name.charAt(0).toUpperCase() + name.slice(1)} ({stats.count})
                    </div>
                    <div
                      className={`text-lg font-bold ${
                        name.includes("weapon") || name.includes("knife") || name.includes("gun")
                          ? "text-red-400"
                          : "text-white"
                      }`}
                    >
                      {stats.maxConfidence.toFixed(0)}%
                    </div>
                  </div>
                ))}
              {/* {Object.keys(objectStats).length === 0 && (
                <div className="col-span-4 text-center text-slate-400 py-4">
                  {accumulatedObjects.length === 0 ? "No objects detected yet" : "Processing objects..."}
                </div>
              )} */}
            </div> */}
          {/* </div> */}
        {/* </div> */}

        {hasWeaponThreat && (
          <div className="mt-4 rounded-lg bg-red-500/10 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <h4 className="font-medium text-red-400">Critical Alert</h4>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              Dangerous object detected in video stream. Security personnel have been notified. Timestamp:{" "}
              {new Date().toLocaleTimeString()}
            </p>
          </div>
        )}
      </CardContent>
      {showAnalysis && threatAnalysis && (
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Threat Analysis Report</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAnalysis(false)}
              className="border-purple-500 text-purple-500 hover:bg-purple-950/20"
            >
              Close Report
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-lg bg-white/5 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-medium text-white">Overall Threat Level</h4>
                <span
                  className={`text-sm font-bold ${
                    threatAnalysis.threat_level === "high"
                      ? "text-red-400"
                      : threatAnalysis.threat_level === "medium"
                        ? "text-amber-400"
                        : "text-green-400"
                  }`}
                >
                  {threatAnalysis.threat_level} ({threatAnalysis.threat_percentage}%)
                </span>
              </div>
              <Progress
                value={threatAnalysis.threat_percentage}
                className={`h-2 ${
                  threatAnalysis.threat_level === "high"
                    ? "bg-red-500"
                    : threatAnalysis.threat_level === "medium"
                      ? "bg-amber-500"
                      : "bg-green-500"
                }`}
              />
            </div>

            <div className="rounded-lg bg-white/5 p-4">
              <h4 className="font-medium text-white mb-3">Risk Assessment</h4>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-xs text-red-300">High Risk</div>
                  <div className="text-lg font-bold text-red-400">{threatAnalysis.risk_breakdown.high}%</div>
                </div>
                <div>
                  <div className="text-xs text-amber-300">Medium Risk</div>
                  <div className="text-lg font-bold text-amber-400">{threatAnalysis.risk_breakdown.medium}%</div>
                </div>
                <div>
                  <div className="text-xs text-green-300">Low Risk</div>
                  <div className="text-lg font-bold text-green-400">{threatAnalysis.risk_breakdown.low}%</div>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-white/5 p-4">
            <h4 className="font-medium text-white mb-3">Flagged Objects</h4>
            <p className="text-sm text-slate-300 mb-3">{threatAnalysis.flagged_content}</p>
            <div className="flex flex-wrap gap-2">
              {threatAnalysis.detected_keywords.map((keyword: string, index: number) => (
                <span
                  key={index}
                  className="px-2 py-1 text-xs rounded bg-red-500/20 text-red-300 border border-red-500/30"
                >
                  {keyword}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-white/5 p-4">
            <h4 className="font-medium text-white mb-3">Summary</h4>
            <p className="text-sm text-slate-300">{threatAnalysis.summary}</p>
          </div>

          <div className="rounded-lg bg-white/5 p-4">
            <h4 className="font-medium text-white mb-3">Recommendations</h4>
            <ul className="text-sm text-slate-300 space-y-1">
              {threatAnalysis.recommendations.map((rec: string, index: number) => (
                <li key={index} className="flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  )
}
