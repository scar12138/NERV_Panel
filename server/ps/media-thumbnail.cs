// Strongly typed WinRT access avoids PowerShell 5.1's unprojected stream RCWs.
using System;
using System.IO;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Windows.Storage.Streams;

namespace NervMedia {
 public sealed class Thumbnail {
  public string hash = "", b64, mime;
 }
 public static class ThumbnailReader {
  static object Wait(object operation, Type resultType) {
   foreach (var method in typeof(System.WindowsRuntimeSystemExtensions).GetMethods()) {
    if (method.Name == "AsTask" && method.IsGenericMethodDefinition && method.GetGenericArguments().Length == 1 && method.GetParameters().Length == 1 && method.GetParameters()[0].ParameterType.Name == "IAsyncOperation`1") {
     var task = (Task)method.MakeGenericMethod(resultType).Invoke(null, new object[] { operation });
     if (!task.Wait(4000)) throw new TimeoutException("Thumbnail operation timed out");
     return task.GetType().GetProperty("Result").GetValue(task, null);
    }
   }
   throw new InvalidOperationException("WinRT AsTask unavailable");
  }
  public static Thumbnail Read(object reference) {
   var none = new Thumbnail();
   if (reference == null) return none;
   var source = (IRandomAccessStreamReference)reference;
   using (var stream = (IRandomAccessStreamWithContentType)Wait(source.OpenReadAsync(), typeof(IRandomAccessStreamWithContentType))) {
    // Decode only bounded input, then emit a small JPEG independent of the
    // player's MIME string (some players return comma-separated aliases).
    if (stream.Size == 0 || stream.Size > 4 * 1024 * 1024) return none;
    using (var reader = new DataReader(stream.GetInputStreamAt(0))) {
     uint expected = (uint)stream.Size;
     uint loaded = (uint)Wait(reader.LoadAsync(expected), typeof(uint));
     if (loaded != expected) return none;
     var bytes = new byte[loaded]; reader.ReadBytes(bytes);
     using (var input = new MemoryStream(bytes))
     using (var image = Image.FromStream(input, true, true)) {
      if (image.Width < 1 || image.Height < 1 || (long)image.Width * image.Height > 40000000) return none;
      double scale = Math.Min(1, 320.0 / Math.Max(image.Width, image.Height));
      using (var bitmap = new Bitmap(Math.Max(1, (int)(image.Width * scale)), Math.Max(1, (int)(image.Height * scale)))) {
       using (var graphics = Graphics.FromImage(bitmap)) {
        graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
        graphics.DrawImage(image, 0, 0, bitmap.Width, bitmap.Height);
       }
       using (var output = new MemoryStream()) {
        bitmap.Save(output, ImageFormat.Jpeg);
        bytes = output.ToArray();
        if (bytes.Length > 262144) return none;
        using (var sha = SHA256.Create()) return new Thumbnail {
         hash = BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(),
         b64 = Convert.ToBase64String(bytes), mime = "image/jpeg"
        };
       }
      }
     }
    }
   }
  }
 }
}
