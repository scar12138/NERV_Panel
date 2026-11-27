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
  [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection devices);
  [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
 }
 [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice {
  [PreserveSig] int Activate(ref Guid iid, int context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
  [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore store);
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
 [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceCollection {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int Item(uint index, out IMMDevice device);
 }
 [StructLayout(LayoutKind.Sequential)] struct PropertyKey {
  public Guid format; public uint id;
  public PropertyKey(Guid format, uint id) { this.format = format; this.id = id; }
 }
 // Including the counted-array union member gives PROPVARIANT its native size
 // on both x64 (24 bytes) and x86 (16 bytes).
 [StructLayout(LayoutKind.Sequential)] struct CountedArray { public uint count; public IntPtr pointer; }
 [StructLayout(LayoutKind.Explicit)] struct PropVariant {
  [FieldOffset(0)] public ushort type;
  [FieldOffset(8)] public IntPtr pointer;
  [FieldOffset(8)] public CountedArray array;
 }
 [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IPropertyStore {
  [PreserveSig] int GetCount(out uint count);
  [PreserveSig] int GetAt(uint index, out PropertyKey key);
  [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
  [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
  [PreserveSig] int Commit();
 }
 // Undocumented Windows PolicyConfig interface (Vista+ desktop Windows, including
 // Windows 10/11). Not a supported public Microsoft API: future builds may fail
 // activation/calls, surfaced as DEVICE_SWITCH_UNAVAILABLE. All preceding vtable
 // slots are required even though only SetDefaultEndpoint is called.
 [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigClient {}
 [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IPolicyConfig {
  [PreserveSig] int GetMixFormat([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr format);
  [PreserveSig] int GetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultFormat, out IntPtr format);
  [PreserveSig] int ResetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id);
  [PreserveSig] int SetDeviceFormat([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr endpointFormat, IntPtr mixFormat);
  [PreserveSig] int GetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, int defaultPeriod, out long period, out long minimum);
  [PreserveSig] int SetProcessingPeriod([MarshalAs(UnmanagedType.LPWStr)] string id, ref long period);
  [PreserveSig] int GetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int SetShareMode([MarshalAs(UnmanagedType.LPWStr)] string id, IntPtr mode);
  [PreserveSig] int GetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, ref PropertyKey key, out PropVariant value);
  [PreserveSig] int SetPropertyValue([MarshalAs(UnmanagedType.LPWStr)] string id, ref PropertyKey key, ref PropVariant value);
  [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
  [PreserveSig] int SetEndpointVisibility([MarshalAs(UnmanagedType.LPWStr)] string id, int visible);
 }
 public class DeviceRow {
  public string id, name, flow;
  public bool isDefault;
 }
 public class DeviceSnapshot {
  public bool ok = true;
  public string error;
  public long ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
  public string defaultRole = "multimedia";
  public string[] switchRoles = new string[] { "console", "multimedia", "communications" };
  public List<DeviceRow> devices = new List<DeviceRow>();
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
  [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant value);
  static bool ValidDevice(string id, string flow) {
   return id != null && System.Text.RegularExpressions.Regex.IsMatch(id, @"\Adevice:[a-f0-9]{64}\z") && (flow == "output" || flow == "input");
  }
  static string FriendlyName(IMMDevice device, string flow) {
   IPropertyStore store = null;
   PropVariant value = new PropVariant();
   try {
    Check(device.OpenPropertyStore(0, out store));
    var key = new PropertyKey(new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), 14);
    Check(store.GetValue(ref key, out value));
    string name = value.type == 31 ? Marshal.PtrToStringUni(value.pointer) : null;
    return String.IsNullOrWhiteSpace(name) ? (flow == "output" ? "Audio output" : "Audio input") : name;
   } finally { PropVariantClear(ref value); Release(store); }
  }
  // The native ID remains local to this command, never part of the public JSON.
  static DeviceSnapshot EnumerateDevices(string matchId, string matchFlow, out string nativeId) {
   nativeId = null;
   var result = new DeviceSnapshot();
   object enumerator = null;
   try {
    enumerator = new Enumerator();
    var source = (IMMDeviceEnumerator)enumerator;
    for (int flow = 0; flow < 2; flow++) {
     string flowName = flow == 0 ? "output" : "input";
     string defaultId = null;
     IMMDevice defaultDevice = null;
     IMMDeviceCollection collection = null;
     try {
      int hr = source.GetDefaultAudioEndpoint(flow, 1, out defaultDevice);
      // E_NOTFOUND means this flow currently has no default endpoint.
      if (hr >= 0) Check(defaultDevice.GetId(out defaultId));
      else if (hr != unchecked((int)0x80070490)) Check(hr);
      Check(source.EnumAudioEndpoints(flow, 1, out collection)); // DEVICE_STATE_ACTIVE
      uint count; Check(collection.GetCount(out count));
      for (uint i = 0; i < count; i++) {
       IMMDevice device = null;
       try {
        Check(collection.Item(i, out device));
        string rawId; Check(device.GetId(out rawId));
        string opaqueId = "device:" + Hash(rawId);
        result.devices.Add(new DeviceRow { id = opaqueId, name = FriendlyName(device, flowName), flow = flowName, isDefault = rawId == defaultId });
        if (opaqueId == matchId && flowName == matchFlow) nativeId = rawId;
       } finally { Release(device); }
      }
     } finally { Release(collection); Release(defaultDevice); }
    }
   } catch (COMException) { result.ok = false; result.error = "AUDIO_UNAVAILABLE"; }
   finally { Release(enumerator); }
   return result;
  }
  public static DeviceSnapshot Devices() {
   string unused; return EnumerateDevices(null, null, out unused);
  }
  public static DeviceSnapshot SetDevice(string id, string flow) {
   if (!ValidDevice(id, flow)) return new DeviceSnapshot { ok = false, error = "INVALID_DEVICE" };
   string nativeId;
   var result = EnumerateDevices(id, flow, out nativeId);
   if (!result.ok) return result;
   if (nativeId == null) { result.ok = false; result.error = "DEVICE_NOT_FOUND"; return result; }
   object policy = null;
   string switchError = null;
   try {
    policy = new PolicyConfigClient();
    // Console, multimedia, communications. Windows offers no atomic transaction:
    // on a later-role failure return the fresh snapshot plus an explicit error.
    for (int role = 0; role < 3; role++) Check(((IPolicyConfig)policy).SetDefaultEndpoint(nativeId, role));
   } catch (COMException) { switchError = "DEVICE_SWITCH_UNAVAILABLE"; }
   finally { Release(policy); }
   result = Devices();
   if (switchError != null) { result.ok = false; result.error = switchError; }
   return result;
  }
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
