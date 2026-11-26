// Core Audio declarations: vtable order must match the Windows SDK interfaces.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Drawing;
using System.IO;

namespace NervAudio {
 [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class Enumerator {}
 [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
 }
 [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
  int OpenPropertyStore(int access, out IntPtr store);
  [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
 }
 [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionManager2 {
  int GetAudioSessionControl(IntPtr guid, uint flags, out IntPtr control);
  int GetSimpleAudioVolume(IntPtr guid, uint flags, out IntPtr volume);
  [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
 }
 [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionEnumerator {
  [PreserveSig] int GetCount(out int count);
  [PreserveSig] int GetSession(int index, out IAudioSessionControl session);
 }
 [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionControl {
  [PreserveSig] int GetState(out int state);
  [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  int SetDisplayName(string name, IntPtr context);
  [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
  int SetIconPath(string path, IntPtr context);
  int GetGroupingParam(out Guid grouping);
  int SetGroupingParam(ref Guid grouping, IntPtr context);
  int RegisterAudioSessionNotification(IntPtr notify);
  int UnregisterAudioSessionNotification(IntPtr notify);
 }
 [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioSessionControl2 {
  [PreserveSig] int GetState(out int state);
  [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
  int SetDisplayName(string name, IntPtr context);
  [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
  int SetIconPath(string path, IntPtr context);
  int GetGroupingParam(out Guid grouping);
  int SetGroupingParam(ref Guid grouping, IntPtr context);
  int RegisterAudioSessionNotification(IntPtr notify);
  int UnregisterAudioSessionNotification(IntPtr notify);
  [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
  [PreserveSig] int GetProcessId(out uint pid);
  [PreserveSig] int IsSystemSoundsSession();
  int SetDuckingPreference(bool optOut);
 }
 [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface ISimpleAudioVolume {
  [PreserveSig] int SetMasterVolume(float volume, ref Guid context);
  [PreserveSig] int GetMasterVolume(out float volume);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
 }
 [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioEndpointVolume {
  int RegisterControlChangeNotify(IntPtr notify);
  int UnregisterControlChangeNotify(IntPtr notify);
  int GetChannelCount(out uint count);
  int SetMasterVolumeLevel(float level, ref Guid context);
  [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
  int GetMasterVolumeLevel(out float level);
  [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
  int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
  int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
  int GetChannelVolumeLevel(uint channel, out float level);
  int GetChannelVolumeLevelScalar(uint channel, out float level);
  [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
  [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
 }
 public class Row {
  public string id, name, iconHash;
  public uint pid;
  public int state;
  public bool isSystemSounds, active, muted;
  public double volume;
 }
 public class Snapshot {
  public bool ok = true, available;
  public string error;
  public long ts;
  public Row master;
  public List<Row> sessions = new List<Row>();
  public Dictionary<string,string> icons = new Dictionary<string,string>();
 }
 public static class Core {
  static readonly Guid Context = new Guid("12279157-2782-4D38-8FB9-4F13C8126DCC");
  static readonly Dictionary<string,string> IconCache = new Dictionary<string,string>();
  static readonly Dictionary<string,string> PathCache = new Dictionary<string,string>();
  static void Check(int hr) { Marshal.ThrowExceptionForHR(hr); }
  static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
  static string Hash(string value) { using(var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-", "").ToLowerInvariant(); }
  static string GetIcon(string path) {
   if (String.IsNullOrEmpty(path)) return null;
   string hash;
   if (PathCache.TryGetValue(path, out hash)) return hash;
   try {
    using (var icon = Icon.ExtractAssociatedIcon(path)) {
     if (icon == null) return null;
     using(var bitmap = icon.ToBitmap()) using(var stream = new MemoryStream()) {
      bitmap.Save(stream, System.Drawing.Imaging.ImageFormat.Png);
      var bytes = stream.ToArray();
      if (bytes.Length > 131072) return null;
      hash = Hash(Convert.ToBase64String(bytes));
      if (IconCache.Count >= 64) { IconCache.Clear(); PathCache.Clear(); }
      IconCache[hash] = Convert.ToBase64String(bytes); PathCache[path] = hash; return hash;
     }
    }
   } catch { return null; }
  }
  // Open and enumerate anew on every command: default-device switches and session
  // creation/expiry become visible immediately; no native session RCWs survive a call.
  public static Snapshot Execute(string id, string operation, double volume, bool muted) {
   object enumerator = null, managerObject = null, endpointObject = null;
   IMMDevice device = null; IAudioSessionEnumerator sessions = null;
   var result = new Snapshot { ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() };
   bool found = operation == "snapshot";
   try {
    enumerator = new Enumerator();
    int hr = ((IMMDeviceEnumerator)enumerator).GetDefaultAudioEndpoint(0, 1, out device);
    if (hr < 0) { result.ok = false; result.error = "NO_OUTPUT_DEVICE"; return result; }
    string deviceId; Check(device.GetId(out deviceId));
    Guid endpointIid = typeof(IAudioEndpointVolume).GUID;
    Check(device.Activate(ref endpointIid, 23, IntPtr.Zero, out endpointObject));
    var endpoint = (IAudioEndpointVolume)endpointObject;
    string masterId = "master:" + Hash(deviceId);
    Guid context = Context;
    if (id == masterId && operation != "snapshot") {
     if (operation == "volume") Check(endpoint.SetMasterVolumeLevelScalar((float)(volume / 100), ref context));
     else if (operation == "mute") Check(endpoint.SetMute(muted, ref context));
     found = true;
    }
    float masterVolume; bool masterMute;
    Check(endpoint.GetMasterVolumeLevelScalar(out masterVolume)); Check(endpoint.GetMute(out masterMute));
    result.master = new Row { id = masterId, name = "Master", volume = Math.Round(masterVolume * 100, 2), muted = masterMute, active = true, state = 1 };
    result.available = true;
    Guid managerIid = typeof(IAudioSessionManager2).GUID;
    Check(device.Activate(ref managerIid, 23, IntPtr.Zero, out managerObject));
    Check(((IAudioSessionManager2)managerObject).GetSessionEnumerator(out sessions));
    int count; Check(sessions.GetCount(out count));
    for(int i = 0; i < count; i++) {
     IAudioSessionControl baseSession = null;
     try {
      Check(sessions.GetSession(i, out baseSession));
      var session = (IAudioSessionControl2)baseSession;
      int state; Check(session.GetState(out state));
      if (state == 2) continue;
      string instance; Check(session.GetSessionInstanceIdentifier(out instance));
      // Never use PID or list index as identity: one process can own many sessions.
      string sessionId = "session:" + Hash(deviceId + "\n" + instance);
      var simple = (ISimpleAudioVolume)session;
      if (id == sessionId && operation != "snapshot") {
       if (operation == "volume") Check(simple.SetMasterVolume((float)(volume / 100), ref context));
       else if (operation == "mute") Check(simple.SetMute(muted, ref context));
       found = true;
      }
      uint pid; Check(session.GetProcessId(out pid));
      bool system = session.IsSystemSoundsSession() == 0;
      string display; session.GetDisplayName(out display);
      string name = system ? "System Sounds" : display;
      string iconHash = null;
      if (!system && pid != 0) try {
       using(var process = Process.GetProcessById((int)pid)) {
        string processPath = null;
        try { processPath = process.MainModule.FileName; } catch { }
        if (String.IsNullOrWhiteSpace(name) || name.StartsWith("@")) {
         try { name = process.MainModule.FileVersionInfo.FileDescription; } catch { }
         if (String.IsNullOrWhiteSpace(name) || name.StartsWith("@")) name = process.ProcessName;
        }
        iconHash = GetIcon(processPath);
       }
      } catch { }
      float scalar; bool mute; Check(simple.GetMasterVolume(out scalar)); Check(simple.GetMute(out mute));
      result.sessions.Add(new Row { id = sessionId, name = String.IsNullOrWhiteSpace(name) ? "Application " + pid : name, pid = pid, state = state, active = state == 1, isSystemSounds = system, volume = Math.Round(scalar * 100, 2), muted = mute, iconHash = iconHash });
      if (iconHash != null && IconCache.ContainsKey(iconHash)) result.icons[iconHash] = IconCache[iconHash];
     } catch (COMException) { /* Session exited during enumeration. */ }
     finally { Release(baseSession); }
    }
    if (!found) { result.ok = false; result.error = "SESSION_NOT_FOUND"; }
    return result;
   } catch(COMException) { result.ok = false; result.error = "AUDIO_UNAVAILABLE"; return result; }
   finally { Release(sessions); Release(managerObject); Release(endpointObject); Release(device); Release(enumerator); }
  }
 }
}
