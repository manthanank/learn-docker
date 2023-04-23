# Learn Docker

![npm](https://img.shields.io/npm/dw/learn-docker)

Check Docker Version :

```bash
docker version
```

Login into Docker :

```bash
docker login
or
docker login -u <username>
```

Search Hub for an image

```bash
docker search <image_name>
```

Publish an image to Docker Hub

```bash
docker push <username>/<image_name>
```

List all images :

```bash
docker image ls
```

Build an Image :

```bash
docker build -t <image-name> .
```

Run an Image :

```bash
docker run <image-name>
```

Start or stop an existing container  :

```bash
docker start|stop <container_name> (or <container-id>)
```

To inspect a running container :

```bash
docker inspect <container_name> (or <container_id>)
```

Pull Image :

```bash
docker pull manthanank/<image-name>
```

List all containers :

```bash
docker ps -a
or
docker ps -all
```

Running containers :

```bash
docker ps
```

Stop an image :

```bash
docker stop <container-id>
```

Delete container :

```bash
docker rm <container-id>
```

Delete an Image :

```bash
docker rmi <image-name>
```

Remove all unused images :

```bash
docker image prune
```

```bash
docker run -it ubuntu
```
