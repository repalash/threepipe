import AVFoundation
import AppKit
import VideoToolbox
// Encodes a folder of PNG frames with alpha to HEVC with alpha, the transparent video Safari plays, with Apple's encoder.
// Run on a Mac by scripts/sample-assets/render-catalog.mjs (--hevc-host).
//
//   swiftc encode-hevc-alpha.swift -o encode-hevc-alpha
//   ./encode-hevc-alpha <folder of PNGs> <out.mov> <quality 0-1> <alpha quality 0-1>
let a = CommandLine.arguments
let files = try FileManager.default.contentsOfDirectory(atPath: a[1]).filter{$0.hasSuffix(".png")}.sorted()
func img(_ p:String)->CGImage{ NSImage(contentsOfFile:a[1]+"/"+p)!.cgImage(forProposedRect:nil,context:nil,hints:nil)! }
let first=img(files[0]); let w=first.width,h=first.height
let url=URL(fileURLWithPath:a[2]); try? FileManager.default.removeItem(at:url)
let writer=try AVAssetWriter(outputURL:url,fileType:.mov); writer.shouldOptimizeForNetworkUse=true
let q=Float(a[3])!, aq=Float(a[4])!
var compression:[String:Any]=[:]
compression[AVVideoQualityKey]=q
compression[kVTCompressionPropertyKey_TargetQualityForAlpha as String]=aq
compression[AVVideoMaxKeyFrameIntervalKey]=24
var settings:[String:Any]=[:]
settings[AVVideoCodecKey]=AVVideoCodecType.hevcWithAlpha
settings[AVVideoWidthKey]=w
settings[AVVideoHeightKey]=h
settings[AVVideoCompressionPropertiesKey]=compression
let input=AVAssetWriterInput(mediaType:.video,outputSettings:settings)
input.expectsMediaDataInRealTime=false
var attrs:[String:Any]=[:]
attrs[kCVPixelBufferPixelFormatTypeKey as String]=kCVPixelFormatType_32BGRA
attrs[kCVPixelBufferWidthKey as String]=w
attrs[kCVPixelBufferHeightKey as String]=h
let ad=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:attrs)
writer.add(input); guard writer.startWriting() else { print("start failed",writer.error ?? ""); exit(1) }
writer.startSession(atSourceTime:.zero)
let t0=Date()
for (i,f) in files.enumerated(){ while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval:0.005) }
 var pb:CVPixelBuffer?; CVPixelBufferPoolCreatePixelBuffer(nil,ad.pixelBufferPool!,&pb); let b=pb!
 CVPixelBufferLockBaseAddress(b,[])
 let ctx=CGContext(data:CVPixelBufferGetBaseAddress(b),width:w,height:h,bitsPerComponent:8,bytesPerRow:CVPixelBufferGetBytesPerRow(b),space:CGColorSpace(name:CGColorSpace.sRGB)!,bitmapInfo:CGImageAlphaInfo.premultipliedFirst.rawValue|CGBitmapInfo.byteOrder32Little.rawValue)!
 ctx.clear(CGRect(x:0,y:0,width:w,height:h)); ctx.draw(img(f),in:CGRect(x:0,y:0,width:w,height:h))
 CVPixelBufferUnlockBaseAddress(b,[])
 if !ad.append(b,withPresentationTime:CMTime(value:CMTimeValue(i),timescale:24)){ print("append failed",writer.error ?? ""); exit(1) } }
input.markAsFinished(); let s=DispatchSemaphore(value:0); writer.finishWriting{s.signal()}; s.wait()
if writer.status != .completed { print("failed",writer.error ?? ""); exit(1) }
let size=(try FileManager.default.attributesOfItem(atPath:a[2])[.size] as! NSNumber).intValue
// read a frame back: corner alpha and how many pixels are see-through
let asset=AVURLAsset(url:url); let sem=DispatchSemaphore(value:0)
Task { let tr=try! await asset.loadTracks(withMediaType:.video)[0]; let ch=try! await tr.load(.mediaCharacteristics)
 let rd=try! AVAssetReader(asset:asset); let o=AVAssetReaderTrackOutput(track:tr,outputSettings:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA]); rd.add(o); rd.startReading()
 let sb=o.copyNextSampleBuffer()!; let ib=CMSampleBufferGetImageBuffer(sb)!; CVPixelBufferLockBaseAddress(ib,.readOnly)
 let p=CVPixelBufferGetBaseAddress(ib)!.assumingMemoryBound(to:UInt8.self); let bpr=CVPixelBufferGetBytesPerRow(ib); var clear=0,part=0,solid=0
 for y in 0..<h { for x in 0..<w { let v=p[y*bpr+x*4+3]; if v<8 {clear+=1} else if v>247 {solid+=1} else {part+=1} } }
 let total:Int=w*h
 let secs:String=String(format:"%.1f",Date().timeIntervalSince(t0))
 let hasAlpha:Bool=ch.contains(.containsAlphaChannel)
 print(url.lastPathComponent,size/1024,"KB",files.count,"frames",secs,"s alpha",hasAlpha,"clear",clear*100/total,"part",part*100/total,"solid",solid*100/total); sem.signal() }
sem.wait()
