// Fonte do assets/bin/RawPrinterHelper.exe — compilar com:
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:..\bin\RawPrinterHelper.exe RawPrinterHelper.cs
//
// Envia um arquivo de bytes já pronto direto pra fila de impressão do Windows
// como datatype RAW — isso faz o Spooler pular a renderização GDI/EMF (onde o
// driver da Brother gasta a maior parte do tempo "invisível" identificado no
// diagnóstico), mas mantém a impressora normalmente registrada no Windows
// (sem trocar driver por WinUSB), então getPrinters()/fallback continuam
// funcionando. Uso: RawPrinterHelper.exe "<Nome da Impressora>" "<arquivo>".
using System;
using System.IO;
using System.Runtime.InteropServices;

internal static class RawPrinterHelper
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DOCINFOW
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinterW(string pPrinterName, out IntPtr phPrinter, IntPtr pDefault);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinterW(IntPtr hPrinter, int level, ref DOCINFOW pDocInfo);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    private static int Main(string[] args)
    {
        if (args.Length != 2)
        {
            Console.Error.WriteLine("Uso: RawPrinterHelper.exe \"<Nome da Impressora>\" \"<arquivo de bytes>\"");
            return 2;
        }

        string printerName = args[0];
        string filePath = args[1];

        byte[] data;
        try
        {
            data = File.ReadAllBytes(filePath);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("Falha ao ler arquivo de bytes: " + ex.Message);
            return 3;
        }

        IntPtr hPrinter;
        if (!OpenPrinterW(printerName, out hPrinter, IntPtr.Zero))
        {
            Console.Error.WriteLine("OpenPrinter falhou (win32 error " + Marshal.GetLastWin32Error() + ")");
            return 4;
        }

        try
        {
            var docInfo = new DOCINFOW
            {
                pDocName = "Checkin Pocket - Etiqueta Raw",
                pOutputFile = null,
                pDataType = "RAW",
            };

            int jobId = StartDocPrinterW(hPrinter, 1, ref docInfo);
            if (jobId == 0)
            {
                Console.Error.WriteLine("StartDocPrinter falhou (win32 error " + Marshal.GetLastWin32Error() + ")");
                return 5;
            }

            try
            {
                if (!StartPagePrinter(hPrinter))
                {
                    Console.Error.WriteLine("StartPagePrinter falhou (win32 error " + Marshal.GetLastWin32Error() + ")");
                    return 6;
                }

                int written;
                bool ok = WritePrinter(hPrinter, data, data.Length, out written);

                EndPagePrinter(hPrinter);

                if (!ok || written != data.Length)
                {
                    Console.Error.WriteLine("WritePrinter falhou ou escreveu menos bytes que o esperado (win32 error " + Marshal.GetLastWin32Error() + ")");
                    return 7;
                }
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }

        return 0;
    }
}
