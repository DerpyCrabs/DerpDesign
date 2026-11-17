#include <QImage>
#include <QFile>
#include <QTemporaryFile>
#include <QElapsedTimer>
#include <cstdio>
int main(){
 QTemporaryFile f; if(!f.open())return 1;
 const int w=1280,h=960,stride=w*4; QByteArray source(stride*h,'\x47');
 if(f.write(source)!=source.size()||!f.flush())return 2;
 for(int mode=0;mode<2;mode++){
 QElapsedTimer t;t.start(); qint64 sum=0;
 for(int i=0;i<400;i++) {QFile in(f.fileName());if(!in.open(QIODevice::ReadOnly))return 4;
 auto* bytes=new QByteArray(in.readAll()); QImage image;
 if(mode==0){QImage borrowed(reinterpret_cast<const uchar*>(bytes->constData()),w,h,stride,QImage::Format_ARGB32_Premultiplied);image=borrowed.copy();delete bytes;}
 else image=QImage(reinterpret_cast<const uchar*>(bytes->constData()),w,h,stride,QImage::Format_ARGB32_Premultiplied,[](void* p){delete static_cast<QByteArray*>(p);},bytes);
 QImage retained=image; image={}; if(retained.constBits()[stride*h-1]!=0x47)return 3;sum+=retained.sizeInBytes();
 }
 printf("%s: %.3f ms/frame, bytes=%lld\n",mode?"owned-buffer":"read-copy",t.nsecsElapsed()/400e6,(long long)sum);
 }
}
